'use strict';

const clc      = require('cli-color');
const gulp     = require('gulp');
const data     = require('gulp-data');
const usage    = require('gulp-help-doc');
const fs       = require('fs');
const path     = require('path');
const zip      = require('gulp-zip');
const inquirer = require('inquirer');
const AWS      = require('aws-sdk');

let CwLogs;
let lambdaConfig;

try {
  lambdaConfig = require(path.join(__dirname, 'lambda-config.json'));
  CwLogs = require('./cw-logs');
} catch(err) {
  const allowedTasksWithoutConfigSet = ['configure', 'help', 'default'];
  if (process.argv[2] && allowedTasksWithoutConfigSet.indexOf(process.argv[2]) === -1) {
    console.log('WARNING! lambda config not found, run command', clc.cyan('gulp configure'));
    process.exit();
  }
  lambdaConfig = null;
}

/**
 * List all gulp tasks and their descriptions;
 * @task {help}
 * @order {0}
 */
gulp.task('help', function(){ return usage(gulp); });

gulp.task('default', ['help']);

/**
 * Set-up all settings of your AWS Lambda;
 * @task {configure}
 * @order {1}
 */
gulp.task('configure', function(next){
  inquirer.prompt([
    {type: 'input', name: 'FunctionName', message: 'Function name:', default: lambdaConfig? lambdaConfig.ConfigOptions.FunctionName:'my-lambda'},
    {type: 'input', name: 'Region', message: 'Region:',  default: lambdaConfig? lambdaConfig.Region:'eu-west-1'},
    {type: 'input', name: 'Description', message: 'Description:',  default: lambdaConfig? lambdaConfig.ConfigOptions.Description:null},
    {type: 'input', name: 'Role', message: 'Role arn:',  default: lambdaConfig? lambdaConfig.ConfigOptions.Role:null},
    {type: 'input', name: 'Handler', message: 'Handler:',  default: lambdaConfig? lambdaConfig.ConfigOptions.Handler:'index.handler'},
    {type: 'input', name: 'MemorySize', message: 'MemorySize:',  default: lambdaConfig? lambdaConfig.ConfigOptions.MemorySize:'128'},
    {type: 'input', name: 'Timeout', message: 'Timeout:',  default: lambdaConfig? lambdaConfig.ConfigOptions.Timeout:'3'},
    {type: 'input', name: 'Runtime', message: 'Runtime:',  default: lambdaConfig? lambdaConfig.ConfigOptions.Runtime:'nodejs4.3'}
  ]).then( function (config_answers) {
    lambdaConfig = {
      Region: config_answers.Region,
      ConfigOptions: {
        FunctionName: config_answers.FunctionName,
        Description: config_answers.Description,
        Role: config_answers.Role,
        Handler: config_answers.Handler,
        MemorySize: config_answers.MemorySize,
        Timeout: config_answers.Timeout,
        Runtime: config_answers.Runtime
      }
    };

    const lambdaPackage = require(path.join(__dirname, 'src/package.json'));
    lambdaPackage.name = config_answers.FunctionName;
    lambdaPackage.description = config_answers.Description;
    fs.writeFileSync(path.join(__dirname, '/src/package.json'), JSON.stringify(lambdaPackage, null, 2));
    fs.writeFileSync(path.join(__dirname, '/lambda-config.json'), JSON.stringify(lambdaConfig, null, 2));
    console.log('\n',lambdaConfig,'\n\n', clc.green('Lambda configuration saved'));
    next();
  });
});

/**
 *  Wraps everything inside the src folder in a zip file and uploads
 *  it to AWS to create your new AWS Lambda using the configuration
 *  information you set in the lambda_config.json file;
 *  @task {create}
 *  @order {2}
 */
gulp.task('create', function(next){
  buildLambdaZip(function(zip){
    const params = lambdaConfig.ConfigOptions;
    const lambda = new AWS.Lambda({ region: lambdaConfig.Region });
    params.Code = { ZipFile: zip };

    lambda.createFunction(params, function(err, data) {
      if (err){
        console.log(clc.red('FAILED'), '-', clc.red(err.message));
        console.log(err);
      }
      else console.log(clc.green('SUCCESS'), '- lambda', clc.cyan(data.FunctionName), 'created');
      next();
    });
  });
});

/**
 *  Wraps everything inside the src folder in a zip file and uploads
 *  it to AWS to update your existing AWS Lambda using the configuration
 *  information you set in the lambda-config.json file;
 *  @task {update}
 *  @order {3}
 */
gulp.task('update', ['update-config', 'update-code']);

/**
 *  Wraps everything inside the src folder in a zip file and uploads
 *  it to AWS to update the code of your existing AWS Lambda;
 *  @task {update-code}
 *  @order {4}
 */
gulp.task('update-code', function(next){
  buildLambdaZip(function(zip) {
    const lambda = new AWS.Lambda({ region: lambdaConfig.Region });
    const params = {
      FunctionName: lambdaConfig.ConfigOptions.FunctionName,
      ZipFile: zip
    };
    lambda.updateFunctionCode(params, function(err, data) {
      if (err){
        console.log(clc.red('FAILED'), '-', clc.red(err.message));
        console.log(err);
      }
      else {
        console.log(clc.green('SUCCESS'), '- lambda', clc.cyan(data.FunctionName), 'code updated');
        console.log(data);
      }
      next();
    });
  });
});

/**
 *  Changes your AWS Lambda configuration using the information
 *  you set in the lambda-config.json file;
 *  @task {update-config}
 *  @order {5}
 */
gulp.task('update-config', function(next){
  const lambda = new AWS.Lambda({ region: lambdaConfig.Region });

  lambda.updateFunctionConfiguration(lambdaConfig.ConfigOptions, function(err, data) {
    if (err){
      console.log(clc.red('FAILED'), '-', clc.red(err.message));
      console.log(err);
    }
    else {
      console.log(clc.green('SUCCESS'), '- lambda', clc.cyan(data.FunctionName), 'config updated');
      console.log(data);
    }
    next();
  });
});

/**
 *  Deletes your AWS Lambda function;
 *  @task {update-config}
 *  @order {6}
 */
gulp.task('delete',function(next){
  const lambda = new AWS.Lambda({ region: lambdaConfig.Region });
  lambda.deleteFunction({ FunctionName: lambdaConfig.ConfigOptions.FunctionName }, function(err) {
    if (err){
      console.log(clc.red('FAILED'), '-', clc.red(err.message));
      console.log(err);
    }
    else console.log(clc.green('SUCCESS'), '- lambda deleted');

    next();
  });
});

/**
 *  Prints in the console all logs generated by you Lambda
 *  function in Amazon CloudWatch;
 *  @task {logs}
 *  @order {7}
 */
gulp.task('logs', function(){
  setInterval(CwLogs.printLogs, 2000);
});

/**
 * Invokes the Lambda function passing test-payload.json as
 * payload and printing the response to the console;
 * @task {invoke}
 * @order {8}
 */
gulp.task('invoke', function(next){
  const lambda = new AWS.Lambda({ region: lambdaConfig.Region });

  let payload;
  try {
    payload = JSON.stringify(require('./test-payload.json'));
  } catch(err) {
    payload = null;
  }

  var params = {
    FunctionName: lambdaConfig.ConfigOptions.FunctionName,
    InvocationType: 'RequestResponse',
    LogType: 'None',
    Payload: payload
  };

  lambda.invoke(params, function(err, data) {
    if (err) console.log(err, err.stack);
    else {
      try {
        console.log(JSON.parse(data.Payload));
      } catch (err) {
        console.log(data.Payload);
      }
    }

    next();
  });
});

/**
 * Invokes the Lambda function LOCALLY passing test-payload.json
 * as payload and printing the response to the console;
 * @task {invoke-local}
 * @order {9}
 */
gulp.task('invoke-local', function(next){
  require(path.join(__dirname, 'test-local.js'))(next);
});

function buildLambdaZip(next){
  gulp.src('src/**/*')
    .pipe(zip(lambdaConfig.ConfigOptions.FunctionName+'.zip'))
    .pipe(data(function(data) {
      next(data.contents);
    }));
}
