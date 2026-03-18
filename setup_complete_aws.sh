#!/bin/bash

# Complete AWS Job Watcher Setup Script
# This script sets up the entire AWS infrastructure

set -e

# Configuration
AWS_REGION="eu-west-1"
S3_BUCKET="job-watcher-data"
JOBS_TABLE="jobs"
COMPANIES_TABLE="companies"
LAMBDA_FUNCTION="job-scraper"
IAM_ROLE="JobWatcherLambdaRole"
SCHEDULE_RULE="job-scraper-schedule"

echo "🚀 Starting Complete AWS Job Watcher Setup"
echo "=========================================="

# Check AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    echo "Download from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
echo "🔐 Checking AWS credentials..."
aws sts get-caller-identity > /dev/null
if [ $? -ne 0 ]; then
    echo "❌ AWS credentials not configured. Run 'aws configure' first."
    echo "You need:"
    echo "  - AWS Access Key ID"
    echo "  - AWS Secret Access Key"
    echo "  - Default region (eu-west-1)"
    exit 1
fi

echo "✅ AWS credentials configured"

# Step 1: Create S3 bucket
echo ""
echo "📦 Step 1: Creating S3 bucket..."
aws s3 mb s3://$S3_BUCKET --region $AWS_REGION || echo "✅ S3 bucket already exists"

# Step 2: Create IAM role
echo ""
echo "👤 Step 2: Creating IAM role..."

# Create trust policy
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create IAM role
aws iam create-role --role-name $IAM_ROLE --assume-role-policy-document file://trust-policy.json || echo "✅ IAM role already exists"

# Get role ARN
ROLE_ARN=$(aws iam get-role --role-name $IAM_ROLE --query 'Role.Arn' --output text)

# Attach AWS managed policies
echo "📋 Attaching IAM policies..."
aws iam attach-role-policy --role-name $IAM_ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || echo "✅ Basic execution policy already attached"

# Create custom DynamoDB policy
cat > dynamodb-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:PutItem",
                "dynamodb:GetItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:DescribeTable"
            ],
            "Resource": [
                "arn:aws:dynamodb:$AWS_REGION:*:table/$JOBS_TABLE",
                "arn:aws:dynamodb:$AWS_REGION:*:table/$COMPANIES_TABLE"
            ]
        }
    ]
}
EOF

aws iam put-role-policy --role-name $IAM_ROLE --policy-name DynamoDBAccess --policy-document file://dynamodb-policy.json

# Wait for role to be ready
echo "⏳ Waiting for IAM role to be ready..."
sleep 10

# Step 3: Create DynamoDB tables
echo ""
echo "📊 Step 3: Creating DynamoDB tables..."

# Create jobs table
echo "   Creating jobs table..."
aws dynamodb create-table \
    --table-name $JOBS_TABLE \
    --attribute-definitions \
        AttributeName=url,AttributeType=S \
        AttributeName=company,AttributeType=S \
    --key-schema \
        AttributeName=url,KeyType=HASH \
        AttributeName=company,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --region $AWS_REGION \
    --tags Key=Project,Value=JobWatcher Key=Environment,Value=Production 2>/dev/null || echo "   ✅ Jobs table already exists"

# Create companies table
echo "   Creating companies table..."
aws dynamodb create-table \
    --table-name $COMPANIES_TABLE \
    --attribute-definitions \
        AttributeName=name,AttributeType=S \
    --key-schema \
        AttributeName=name,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region $AWS_REGION \
    --tags Key=Project,Value=JobWatcher Key=Environment,Value=Production 2>/dev/null || echo "   ✅ Companies table already exists"

# Wait for tables to be created
echo "⏳ Waiting for tables to be ready..."
aws dynamodb wait table-exists --table-name $JOBS_TABLE --region $AWS_REGION 2>/dev/null || echo "   ✅ Jobs table already exists"
aws dynamodb wait table-exists --table-name $COMPANIES_TABLE --region $AWS_REGION 2>/dev/null || echo "   ✅ Companies table already exists"

# Step 4: Package Lambda function
echo ""
echo "📦 Step 4: Packaging Lambda function..."

# Create requirements.txt for Lambda
cat > requirements.txt << EOF
requests==2.31.0
beautifulsoup4==4.12.2
boto3==1.34.0
EOF

# Package Lambda
zip lambda_scraper.zip lambda_scraper_dynamodb.py requirements.txt

# Step 5: Deploy Lambda function
echo ""
echo "🚀 Step 5: Deploying Lambda function..."

# Create Lambda function
aws lambda create-function \
    --function-name $LAMBDA_FUNCTION \
    --runtime python3.11 \
    --role $ROLE_ARN \
    --handler lambda_scraper_dynamodb.lambda_handler \
    --zip-file fileb://lambda_scraper.zip \
    --environment Variables={JOBS_TABLE=$JOBS_TABLE,COMPANIES_TABLE=$COMPANIES_TABLE,AWS_REGION=$AWS_REGION} \
    --timeout 900 \
    --memory-size 512 \
    --region $AWS_REGION 2>/dev/null || echo "✅ Lambda function already exists"

# Update function if it exists
aws lambda update-function-code \
    --function-name $LAMBDA_FUNCTION \
    --zip-file fileb://lambda_scraper.zip 2>/dev/null || echo "✅ Lambda function code updated"

# Update function configuration
aws lambda update-function-configuration \
    --function-name $LAMBDA_FUNCTION \
    --environment Variables={JOBS_TABLE=$JOBS_TABLE,COMPANIES_TABLE=$COMPANIES_TABLE,AWS_REGION=$AWS_REGION} \
    --timeout 900 \
    --memory-size 512 2>/dev/null || echo "✅ Lambda function configuration updated"

# Step 6: Set up CloudWatch schedule
echo ""
echo "⏰ Step 6: Setting up CloudWatch schedule..."

# Create schedule rule
aws events put-rule \
    --name $SCHEDULE_RULE \
    --schedule-expression "cron(0 17 * * ? *)" \
    --description "Run job scraper daily at 5 PM UTC" \
    --region $AWS_REGION 2>/dev/null || echo "✅ CloudWatch rule already exists"

# Add permission for CloudWatch to invoke Lambda
aws lambda add-permission \
    --function-name $LAMBDA_FUNCTION \
    --statement-id $SCHEDULE_RULE \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn $(aws events describe-rule --name $SCHEDULE_RULE --query 'Arn' --output text) 2>/dev/null || echo "✅ Lambda permission already exists"

# Set CloudWatch target
aws events put-targets \
    --rule $SCHEDULE_RULE \
    --targets "Id"="1","Arn"=$(aws lambda get-function --function-name $LAMBDA_FUNCTION --query 'Configuration.FunctionArn' --output text) 2>/dev/null || echo "✅ CloudWatch target already set"

# Step 7: Test the Lambda function
echo ""
echo "🧪 Step 7: Testing Lambda function..."
aws lambda invoke \
    --function-name $LAMBDA_FUNCTION \
    --payload '{}' \
    response.json

echo "📊 Lambda response:"
cat response.json

# Step 8: Display configuration information
echo ""
echo "✅ AWS Setup Complete!"
echo "=================================="
echo ""
echo "📋 Your AWS Resources:"
echo "  🏗️  Lambda Function: $LAMBDA_FUNCTION"
echo "  📊  DynamoDB Tables: $JOBS_TABLE, $COMPANIES_TABLE"
echo "  📦  S3 Bucket: $S3_BUCKET"
echo "  ⏰  CloudWatch Schedule: $SCHEDULE_RULE (daily at 5 PM UTC)"
echo "  👤  IAM Role: $IAM_ROLE"
echo "  🌍  Region: $AWS_REGION"
echo ""
echo "🔧 Lambda Function ARN:"
aws lambda get-function --function-name $LAMBDA_FUNCTION --query 'Configuration.FunctionArn' --output text
echo ""
echo "📋 Next Steps for Vercel:"
echo "1. Go to your Vercel project dashboard"
echo "2. Add these Environment Variables:"
echo "   - AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --output text)"
echo "   - AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --output text)"
echo "   - AWS_REGION=$AWS_REGION"
echo "   - JOBS_TABLE=$JOBS_TABLE"
echo "   - COMPANIES_TABLE=$COMPANIES_TABLE"
echo ""
echo "3. Update your API routes:"
echo "   - Copy jobs-dynamodb.js to src/pages/api/jobs.js"
echo "   - Copy stats-dynamodb.js to src/pages/api/stats.js"
echo ""
echo "4. Deploy Vercel:"
echo "   vercel --prod"
echo ""
echo "5. Test the complete workflow:"
echo "   curl https://your-site.vercel.app/api/jobs"
echo ""
echo "📊 Useful Commands:"
echo "  # View Lambda logs"
echo "  aws logs tail /aws/lambda/$LAMBDA_FUNCTION --follow"
echo ""
echo "  # View DynamoDB tables"
echo "  aws dynamodb describe-table --table-name $JOBS_TABLE"
echo "  aws dynamodb describe-table --table-name $COMPANIES_TABLE"
echo ""
echo "  # View table items"
echo "  aws dynamodb scan --table-name $JOBS_TABLE"
echo "  aws dynamodb scan --table-name $COMPANIES_TABLE"
echo ""
echo "  # Trigger manual run"
echo "  aws lambda invoke --function-name $LAMBDA_FUNCTION --payload '{}' response.json"
echo ""
echo "  # Update companies list"
echo "  aws lambda update-function-configuration --function-name $LAMBDA_FUNCTION --environment Variables='{JOBS_TABLE=$JOBS_TABLE,COMPANIES_TABLE=$COMPANIES_TABLE,AWS_REGION=$AWS_REGION,COMPANIES_JSON=$(cat companies.json | jq -c .)}'"
echo ""

# Clean up temporary files
rm -f trust-policy.json dynamodb-policy.json lambda_scraper.zip requirements.txt response.json

echo "🎉 Your AWS Job Watcher is now fully configured and running!"
echo "🌐 Your Lambda function will run daily at 5 PM UTC"
echo "📊 Jobs will be stored in DynamoDB and accessible via Vercel API"
