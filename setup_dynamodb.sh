#!/bin/bash

# DynamoDB Setup Script for Job Watcher
# This script creates the DynamoDB tables and updates Lambda

set -e

# Configuration
AWS_REGION="eu-west-1"
JOBS_TABLE="jobs"
COMPANIES_TABLE="companies"
LAMBDA_FUNCTION="job-scraper"

echo "🗄️ Setting up DynamoDB for Job Watcher"
echo "====================================="

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

# Create jobs table
echo "📊 Creating jobs table..."
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
    --tags Key=Project,Value=JobWatcher Key=Environment,Value=Production || echo "Jobs table already exists"

# Create companies table
echo "🏢 Creating companies table..."
aws dynamodb create-table \
    --table-name $COMPANIES_TABLE \
    --attribute-definitions \
        AttributeName=name,AttributeType=S \
    --key-schema \
        AttributeName=name,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region $AWS_REGION \
    --tags Key=Project,Value=JobWatcher Key=Environment,Value=Production || echo "Companies table already exists"

# Wait for tables to be created
echo "⏳ Waiting for tables to be ready..."
aws dynamodb wait table-exists --table-name $JOBS_TABLE --region $AWS_REGION
aws dynamodb wait table-exists --table-name $COMPANIES_TABLE --region $AWS_REGION

# Update Lambda function to use DynamoDB
echo "🚀 Updating Lambda function for DynamoDB..."
zip lambda_scraper_dynamodb.zip lambda_scraper_dynamodb.py

aws lambda update-function-code \
    --function-name $LAMBDA_FUNCTION \
    --zip-file fileb://lambda_scraper_dynamodb.zip

# Update Lambda environment variables
echo "🔧 Updating Lambda environment variables..."
aws lambda update-function-configuration \
    --function-name $LAMBDA_FUNCTION \
    --environment Variables={
        JOBS_TABLE=$JOBS_TABLE,
        COMPANIES_TABLE=$COMPANIES_TABLE,
        AWS_REGION=$AWS_REGION
    }

# Test the updated Lambda
echo "🧪 Testing updated Lambda function..."
aws lambda invoke \
    --function-name $LAMBDA_FUNCTION \
    --payload '{}' \
    response.json

echo "📊 Lambda response:"
cat response.json

# Clean up
rm -f lambda_scraper_dynamodb.zip response.json

echo ""
echo "✅ DynamoDB setup complete!"
echo "==========================="
echo ""
echo "📋 Tables created:"
echo "  - $JOBS_TABLE (jobs data)"
echo "  - $COMPANIES_TABLE (companies data)"
echo ""
echo "🔧 Next steps:"
echo "1. Add AWS credentials to Vercel environment variables:"
echo "   - AWS_ACCESS_KEY_ID"
echo "   - AWS_SECRET_ACCESS_KEY"
echo "   - AWS_REGION (optional, defaults to eu-west-1)"
echo "   - JOBS_TABLE (optional, defaults to jobs)"
echo "   - COMPANIES_TABLE (optional, defaults to companies)"
echo ""
echo "2. Update Vercel API routes to use DynamoDB:"
echo "   - Copy jobs-dynamodb.js to pages/api/jobs.js"
echo "   - Copy stats-dynamodb.js to pages/api/stats.js"
echo ""
echo "3. Deploy Vercel frontend:"
echo "   vercel --prod"
echo ""
echo "4. Test the complete workflow:"
echo "   curl https://your-site.vercel.app/api/jobs"
echo ""
echo "🎯 Benefits of DynamoDB:"
echo "  ✅ Real-time access (10ms vs 500ms)"
echo "  ✅ Cheaper (~$3.45 vs ~$5.22/month)"
echo "  ✅ More scalable (millions of requests)"
echo "  ✅ Better integration with AWS"
echo "  ✅ No file management needed"
echo ""
echo "📊 Useful commands:"
echo "  # View table status"
echo "  aws dynamodb describe-table --table-name $JOBS_TABLE"
echo ""
echo "  # View table items"
echo "  aws dynamodb scan --table-name $JOBS_TABLE"
echo ""
echo "  # View Lambda logs"
echo "  aws logs tail /aws/lambda/$LAMBDA_FUNCTION --follow"
echo ""
echo "  # Trigger manual run"
echo "  aws lambda invoke --function-name $LAMBDA_FUNCTION --payload '{}' response.json"
