#!/bin/bash

# AWS Job Watcher Deployment Script
# This script sets up the complete AWS infrastructure

set -e

# Configuration
AWS_REGION="eu-west-1"
S3_BUCKET="job-watcher-data"
LAMBDA_FUNCTION="job-scraper"
IAM_ROLE="JobWatcherLambdaRole"
SCHEDULE_RULE="job-scraper-schedule"

echo "🚀 Starting AWS Job Watcher Deployment"
echo "======================================"

# Check AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check AWS credentials
echo "🔐 Checking AWS credentials..."
aws sts get-caller-identity > /dev/null
if [ $? -ne 0 ]; then
    echo "❌ AWS credentials not configured. Run 'aws configure' first."
    exit 1
fi

# Create S3 bucket
echo "📦 Creating S3 bucket..."
aws s3 mb s3://$S3_BUCKET --region $AWS_REGION || echo "Bucket already exists"

# Create IAM role
echo "👤 Creating IAM role..."
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

aws iam create-role --role-name $IAM_ROLE --assume-role-policy-document file://trust-policy.json || echo "Role already exists"

# Attach policies
echo "📋 Attaching IAM policies..."
aws iam attach-role-policy --role-name $IAM_ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

cat > s3-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::$S3_BUCKET",
                "arn:aws:s3:::$S3_BUCKET/*"
            ]
        }
    ]
}
EOF

aws iam put-role-policy --role-name $IAM_ROLE --policy-name S3Access --policy-document file://s3-policy.json

# Wait for role to be created
echo "⏳ Waiting for IAM role to be ready..."
sleep 10

# Get role ARN
ROLE_ARN=$(aws iam get-role --role-name $IAM_ROLE --query 'Role.Arn' --output text)

# Package Lambda function
echo "📦 Packaging Lambda function..."
zip lambda_scraper.zip lambda_scraper.py

# Deploy Lambda function
echo "🚀 Deploying Lambda function..."
aws lambda create-function \
    --function-name $LAMBDA_FUNCTION \
    --runtime python3.11 \
    --role $ROLE_ARN \
    --handler lambda_scraper.lambda_handler \
    --zip-file fileb://lambda_scraper.zip \
    --environment Variables={S3_BUCKET=$S3_BUCKET,S3_KEY=jobs.db} \
    --timeout 900 \
    --memory-size 512 || echo "Function already exists, updating..."

# Update function if it exists
aws lambda update-function-code \
    --function-name $LAMBDA_FUNCTION \
    --zip-file fileb://lambda_scraper.zip 2>/dev/null || echo "Function code updated"

# Create CloudWatch schedule
echo "⏰ Creating CloudWatch schedule..."
aws events put-rule \
    --name $SCHEDULE_RULE \
    --schedule-expression "cron(0 17 * * ? *)" \
    --description "Run job scraper daily at 5 PM UTC" || echo "Rule already exists"

# Add permission for CloudWatch to invoke Lambda
echo "🔐 Adding Lambda permissions..."
aws lambda add-permission \
    --function-name $LAMBDA_FUNCTION \
    --statement-id $SCHEDULE_RULE \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn $(aws events describe-rule --name $SCHEDULE_RULE --query 'Arn' --output text) || echo "Permission already exists"

# Set CloudWatch target
echo "🎯 Setting CloudWatch target..."
aws events put-targets \
    --rule $SCHEDULE_RULE \
    --targets "Id"="1","Arn"=$(aws lambda get-function --function-name $LAMBDA_FUNCTION --query 'Configuration.FunctionArn' --output text) || echo "Target already set"

# Test the Lambda function
echo "🧪 Testing Lambda function..."
aws lambda invoke \
    --function-name $LAMBDA_FUNCTION \
    --payload '{}' \
    response.json

echo "📊 Lambda response:"
cat response.json

# Clean up
rm -f trust-policy.json s3-policy.json lambda_scraper.zip response.json

echo ""
echo "✅ AWS Job Watcher deployment complete!"
echo "======================================"
echo ""
echo "📋 Next steps:"
echo "1. Set up Vercel integration (see AWS_SETUP.md)"
echo "2. Configure environment variables in Lambda:"
echo "   - VERCEL_API_TOKEN"
echo "   - VERCEL_PROJECT_ID"
echo "3. Test the complete workflow"
echo ""
echo "🔧 Useful commands:"
echo "  # View Lambda logs"
echo "  aws logs tail /aws/lambda/$LAMBDA_FUNCTION --follow"
echo ""
echo "  # Trigger manual run"
echo "  aws lambda invoke --function-name $LAMBDA_FUNCTION --payload '{}' response.json"
echo ""
echo "  # Update companies list"
echo "  aws lambda update-function-configuration --function-name $LAMBDA_FUNCTION --environment Variables='{S3_BUCKET=$S3_BUCKET,S3_KEY=jobs.db,COMPANIES_JSON=$(cat companies.json | jq -c .)}'"
echo ""
echo "🌐 Your Lambda function ARN: $ROLE_ARN"
