@echo off
REM Complete AWS Job Watcher Setup Script for Windows
REM This script sets up the entire AWS infrastructure

echo 🚀 Starting Complete AWS Job Watcher Setup
echo ==========================================

REM Check AWS CLI is installed
aws --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ AWS CLI is not installed. Please install it first.
    echo Download from: https://aws.amazon.com/cli/
    pause
    exit /b 1
)

REM Check AWS credentials
echo 🔐 Checking AWS credentials...
aws sts get-caller-identity >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ AWS credentials not configured. Run 'aws configure' first.
    echo You need:
    echo   - AWS Access Key ID
    echo   - AWS Secret Access Key
    echo   - Default region ^(eu-west-1^)
    pause
    exit /b 1
)

echo ✅ AWS credentials configured

REM Configuration
set AWS_REGION=eu-west-1
set S3_BUCKET=job-watcher-data
set JOBS_TABLE=jobs
set COMPANIES_TABLE=companies
set LAMBDA_FUNCTION=job-scraper
set IAM_ROLE=JobWatcherLambdaRole
set SCHEDULE_RULE=job-scraper-schedule

REM Step 1: Create S3 bucket
echo.
echo 📦 Step 1: Creating S3 bucket...
aws s3 mb s3://%S3_BUCKET% --region %AWS_REGION% >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ S3 bucket created successfully
) else (
    echo ✅ S3 bucket already exists
)

REM Step 2: Create IAM role
echo.
echo 👤 Step 2: Creating IAM role...

REM Create trust policy
echo { > trust-policy.json
echo   "Version": "2012-10-17", >> trust-policy.json
echo   "Statement": [ >> trust-policy.json
echo     { >> trust-policy.json
echo       "Effect": "Allow", >> trust-policy.json
echo       "Principal": { >> trust-policy.json
echo         "Service": "lambda.amazonaws.com" >> trust-policy.json
echo       }, >> trust-policy.json
echo       "Action": "sts:AssumeRole" >> trust-policy.json
echo     } >> trust-policy.json
echo   } >> trust-policy.json
echo } >> trust-policy.json

REM Create IAM role
aws iam create-role --role-name %IAM_ROLE% --assume-role-policy-document file://trust-policy.json >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ IAM role created successfully
) else (
    echo ✅ IAM role already exists
)

REM Get role ARN
for /f "tokens=2 delims=" " %%a in ('aws iam get-role --role-name %IAM_ROLE% --query 'Role.Arn' --output text') do set ROLE_ARN=%%a

REM Attach AWS managed policies
echo 📋 Attaching IAM policies...
aws iam attach-role-policy --role-name %IAM_ROLE% --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >nul 2>&1

REM Create custom DynamoDB policy
echo { > dynamodb-policy.json
echo   "Version": "2012-10-17", >> dynamodb-policy.json
echo   "Statement": [ >> dynamodb-policy.json
echo     { >> dynamodb-policy.json
echo       "Effect": "Allow", >> dynamodb-policy.json
echo       "Action": [ >> dynamodb-policy.json
echo         "dynamodb:PutItem", >> dynamodb-policy.json
echo         "dynamodb:GetItem", >> dynamodb-policy.json
echo         "dynamodb:UpdateItem", >> dynamodb-policy.json
echo         "dynamodb:DeleteItem", >> dynamodb-policy.json
echo         "dynamodb:Query", >> dynamodb-policy.json
echo         "dynamodb:Scan", >> dynamodb-policy.json
echo         "dynamodb:DescribeTable" >> dynamodb-policy.json
echo       ], >> dynamodb-policy.json
echo       "Resource": [ >> dynamodb-policy.json
echo         "arn:aws:dynamodb:%AWS_REGION%:*:table/%JOBS_TABLE%", >> dynamodb-policy.json
echo         "arn:aws:dynamodb:%AWS_REGION%:*:table/%COMPANIES_TABLE%" >> dynamodb-policy.json
echo       ] >> dynamodb-policy.json
echo     } >> dynamodb-policy.json
echo   } >> dynamodb-policy.json

aws iam put-role-policy --role-name %IAM_ROLE% --policy-name DynamoDBAccess --policy-document file://dynamodb-policy.json

REM Wait for role to be ready
echo ⏳ Waiting for IAM role to be ready...
timeout /t 10

REM Step 3: Create DynamoDB tables
echo.
echo 📊 Step 3: Creating DynamoDB tables...

REM Create jobs table
echo    Creating jobs table...
aws dynamodb create-table ^
    --table-name %JOBS_TABLE% ^
    --attribute-definitions ^
        AttributeName=url,AttributeType=S ^
        AttributeName=company,AttributeType=S ^
    --key-schema ^
        AttributeName=url,KeyType=HASH ^
        AttributeName=company,KeyType=RANGE ^
    --billing-mode PAY_PER_REQUEST ^
    --region %AWS_REGION% ^
    --tags Key=Project,Value=JobWatcher Key=Environment,Value=Production >nul 2>&1
if %errorlevel% equ 0 (
    echo    ✅ Jobs table created successfully
) else (
    echo    ✅ Jobs table already exists
)

REM Create companies table
echo    Creating companies table...
aws dynamodb create-table ^
    --table-name %COMPANIES_TABLE% ^
    --attribute-definitions ^
        AttributeName=name,AttributeType=S ^
    --key-schema ^
        AttributeName=name,KeyType=HASH ^
    --billing-mode PAY_PER_REQUEST ^
    --region %AWS_REGION% ^
    --tags Key=Project,Value=JobWatcher Key=Environment,Value=Production >nul 2>&1
if %errorlevel% equ 0 (
    echo    ✅ Companies table created successfully
) else (
    echo    ✅ Companies table already exists
)

REM Wait for tables to be ready
echo ⏳ Waiting for tables to be ready...
aws dynamodb wait table-exists --table-name %JOBS_TABLE% --region %AWS_REGION% >nul 2>&1
aws dynamodb wait table-exists --table-name %COMPANIES_TABLE% --region %AWS_REGION% >nul 2>&1

REM Step 4: Package Lambda function
echo.
echo 📦 Step 4: Packaging Lambda function...

REM Create requirements.txt for Lambda
echo requests==2.31.0 > requirements.txt
echo beautifulsoup4==4.12.2 >> requirements.txt
echo boto3==1.34.0 >> requirements.txt

REM Package Lambda
powershell -Command "Compress-Archive -Path lambda_scraper_dynamodb.py,requirements.txt -DestinationPath lambda_scraper.zip -Force"

REM Step 5: Deploy Lambda function
echo.
echo 🚀 Step 5: Deploying Lambda function...

REM Create Lambda function
aws lambda create-function ^
    --function-name %LAMBDA_FUNCTION% ^
    --runtime python3.11 ^
    --role %ROLE_ARN% ^
    --handler lambda_scraper_dynamodb.lambda_handler ^
    --zip-file fileb://lambda_scraper.zip ^
    --environment Variables "{JOBS_TABLE=%JOBS_TABLE%,COMPANIES_TABLE=%COMPANIES_TABLE%,AWS_REGION=%AWS_REGION%}" ^
    --timeout 900 ^
    --memory-size 512 ^
    --region %AWS_REGION% >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Lambda function created successfully
) else (
    echo ✅ Lambda function already exists
)

REM Update function if it exists
aws lambda update-function-code ^
    --function-name %LAMBDA_FUNCTION% ^
    --zip-file fileb://lambda_scraper.zip >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Lambda function code updated
)

REM Update function configuration
aws lambda update-function-configuration ^
    --function-name %LAMBDA_FUNCTION% ^
    --environment Variables "{JOBS_TABLE=%JOBS_TABLE%,COMPANIES_TABLE=%COMPANIES_TABLE%,AWS_REGION=%AWS_REGION%}" ^
    --timeout 900 ^
    --memory-size 512 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Lambda function configuration updated
)

REM Step 6: Set up CloudWatch schedule
echo.
echo ⏰ Step 6: Setting up CloudWatch schedule...

REM Create schedule rule
aws events put-rule ^
    --name %SCHEDULE_RULE% ^
    --schedule-expression "cron(0 17 * * ? *)" ^
    --description "Run job scraper daily at 5 PM UTC" ^
    --region %AWS_REGION% >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ CloudWatch rule created successfully
) else (
    echo ✅ CloudWatch rule already exists
)

REM Add permission for CloudWatch to invoke Lambda
aws lambda add-permission ^
    --function-name %LAMBDA_FUNCTION% ^
    --statement-id %SCHEDULE_RULE% ^
    --action lambda:InvokeFunction ^
    --principal events.amazonaws.com ^
    --source-arn "arn:aws:events:%AWS_REGION%:account:rule/%SCHEDULE_RULE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Lambda permission added successfully
) else (
    echo ✅ Lambda permission already exists
)

REM Set CloudWatch target
aws events put-targets ^
    --rule %SCHEDULE_RULE% ^
    --targets "Id"="1","Arn"="arn:aws:lambda:%AWS_REGION%:account:function:%LAMBDA_FUNCTION%" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ CloudWatch target set successfully
) else (
    echo ✅ CloudWatch target already set
)

REM Step 7: Test the Lambda function
echo.
echo 🧪 Step 7: Testing Lambda function...
aws lambda invoke ^
    --function-name %LAMBDA_FUNCTION% ^
    --payload '{}' ^
    response.json >nul 2>&1

echo 📊 Lambda response:
type response.json

REM Step 8: Display configuration information
echo.
echo ✅ AWS Setup Complete!
echo ================================
echo.
echo 📋 Your AWS Resources:
echo   🏗️  Lambda Function: %LAMBDA_FUNCTION%
echo   📊  DynamoDB Tables: %JOBS_TABLE%, %COMPANIES_TABLE%
echo   📦  S3 Bucket: %S3_BUCKET%
echo   ⏰  CloudWatch Schedule: %SCHEDULE_RULE% ^(daily at 5 PM UTC^)
echo   👤  IAM Role: %IAM_ROLE%
echo   🌍  Region: %AWS_REGION%
echo.
echo 🔧 Lambda Function ARN:
aws lambda get-function --function-name %LAMBDA_FUNCTION% --query 'Configuration.FunctionArn' --output text
echo.
echo 📋 Next Steps for Vercel:
echo 1. Go to your Vercel project dashboard
echo 2. Add these Environment Variables:
echo    - AWS_ACCESS_KEY_ID
echo    - AWS_SECRET_ACCESS_KEY
echo    - AWS_REGION=%AWS_REGION%
echo    - JOBS_TABLE=%JOBS_TABLE%
echo    - COMPANIES_TABLE=%COMPANIES_TABLE%
echo.
echo 3. Update your API routes:
echo    - Copy jobs-dynamodb.js to src/pages/api/jobs.js
echo    - Copy stats-dynamodb.js to src/pages/api/stats.js
echo.
echo 4. Deploy Vercel:
echo    - vercel --prod
echo.
echo 5. Test the complete workflow:
echo    - curl https://your-site.vercel.app/api/jobs
echo.
echo 📊 Useful Commands:
echo   # View Lambda logs
echo   aws logs tail /aws/lambda/%LAMBDA_FUNCTION% --follow
echo.
echo   # View DynamoDB tables
echo   aws dynamodb describe-table --table-name %JOBS_TABLE%
echo   aws dynamodb describe-table --table-name %COMPANIES_TABLE%
echo.
echo   # View table items
echo   aws dynamodb scan --table-name %JOBS_TABLE%
echo   aws dynamodb scan --table-name %COMPANIES_TABLE%
echo.
echo   # Trigger manual run
echo   aws lambda invoke --function-name %LAMBDA_FUNCTION% --payload '{}' response.json
echo.
echo 🎉 Your AWS Job Watcher is now fully configured and running!
echo 🌐 Your Lambda function will run daily at 5 PM UTC
echo 📊 Jobs will be stored in DynamoDB and accessible via Vercel API

REM Clean up temporary files
del trust-policy.json dynamodb-policy.json lambda_scraper.zip requirements.txt response.json

pause
