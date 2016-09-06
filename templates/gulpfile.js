'use strict';

const clc      = require('cli-color');
const gulp     = require('gulp');
const data     = require('gulp-data');
const fs       = require('fs');
const path     = require('path');
const zip      = require('gulp-zip');
const inquirer = require('inquirer');
const AWS      = require('aws-sdk');

let CwLogs;
let lambda_config;

try {
  lambda_config = require(path.join(__dirname, 'lambda_config.json'));
  CwLogs = require('./cw-logs');
} catch(err) {
  if (process.argv[2] && process.argv[2] !== 'configure') {
    console.log('WARNING! lambda config not found, run command', clc.cyan('gulp configure'));
    process.exit();
  }
  lambda_config = null;
}

gulp.task('default', ['configure']);

gulp.task('configure', function(next){
  inquirer.prompt([
    {type: 'input', name: 'FunctionName', message: 'Function name:', default: lambda_config? lambda_config.ConfigOptions.FunctionName:'my-lambda'},
    {type: 'input', name: 'Region', message: 'Region:',  default: lambda_config? lambda_config.Region:'eu-west-1'},
    {type: 'input', name: 'Description', message: 'Description:',  default: lambda_config? lambda_config.ConfigOptions.Description:null},
    {type: 'input', name: 'Role', message: 'Role arn:',  default: lambda_config? lambda_config.ConfigOptions.Role:null},
    {type: 'input', name: 'Handler', message: 'Handler:',  default: lambda_config? lambda_config.ConfigOptions.Handler:'index.handler'},
    {type: 'input', name: 'MemorySize', message: 'MemorySize:',  default: lambda_config? lambda_config.ConfigOptions.MemorySize:'128'},
    {type: 'input', name: 'Timeout', message: 'Timeout:',  default: lambda_config? lambda_config.ConfigOptions.Timeout:'3'},
    {type: 'input', name: 'Runtime', message: 'Runtime:',  default: lambda_config? lambda_config.ConfigOptions.Timeout:'nodejs4.3'}
  ]).then( function (config_answers) {
    lambda_config = {
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
    fs.writeFileSync(path.join(__dirname, '/lambda_config.json'), JSON.stringify(lambda_config, null, 2));
    console.log('\n',lambda_config,'\n\n', clc.green('Lambda configuration saved'));
    next();
  });
});

gulp.task('create', function(next){
  checkConfig();

  buildLambdaZip(function(zip){
    const params = lambda_config.ConfigOptions;
    const lambda = new AWS.Lambda({ region: lambda_config.Region });
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

gulp.task('update', ['update-config', 'update-code']);

gulp.task('update-config', function(next){
  checkConfig();
  const lambda = new AWS.Lambda({ region: lambda_config.Region });

  lambda.updateFunctionConfiguration(lambda_config.ConfigOptions, function(err, data) {
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

gulp.task('update-code', function(next){
  buildLambdaZip(function(zip) {
    const lambda = new AWS.Lambda({ region: lambda_config.Region });
    const params = {
      FunctionName: lambda_config.ConfigOptions.FunctionName,
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

gulp.task('delete',function(next){
  checkConfig();
  const lambda = new AWS.Lambda({ region: lambda_config.Region });
  lambda.deleteFunction({ FunctionName: lambda_config.ConfigOptions.FunctionName }, function(err) {
    if (err){
      console.log(clc.red('FAILED'), '-', clc.red(err.message));
      console.log(err);
    }
    else console.log(clc.green('SUCCESS'), '- lambda deleted');

    next();
  });
});

gulp.task('logs', function(){
  setInterval(CwLogs.printLogs, 2000);
});

gulp.task('invoke', function(next){
  checkConfig();
  const lambda = new AWS.Lambda({ region: lambda_config.Region });

  let payload;

  try {
    payload = JSON.stringify(require('./test-payload.json'));
  } catch(err) {
    payload = null;
  }

  var params = {
    FunctionName: lambda_config.ConfigOptions.FunctionName,
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


function checkConfig(){
  if (!lambda_config) {
    console.log(clc.red('lambda_config.json'), 'not found!', '\nRun', clc.cyan('gulp configure'), 'task to set up your lambda details.');
    process.exit();
  }
}

function buildLambdaZip(next){
  gulp.src('src/**/*')
    .pipe(zip(lambda_config.ConfigOptions.FunctionName+'.zip'))
    .pipe(data(function(data) {
      next(data.contents);
    }));
}
