# 🚀 AWS Job Watcher - Complete Setup Guide

## 📍 Where to Find Everything

### **🔑 AWS Credentials**
1. **AWS Access Key ID**: 
   ```bash
   aws configure get aws_access_key_id --output text
   ```
2. **AWS Secret Access Key**: 
   ```bash
   aws configure get aws_secret_access_key --output text
   ```

### **🏗️ AWS Resources (After Setup)**
1. **Lambda Function ARN**:
   ```bash
   aws lambda get-function --function-name job-scraper --query 'Configuration.FunctionArn' --output text
   ```
2. **DynamoDB Table Names**:
   ```bash
   aws dynamodb list-tables --region eu-west-1 --query 'TableNames[]'
   ```
3. **S3 Bucket Name**:
   ```bash
   aws s3 ls
   ```

### **🌐 Vercel Information**
1. **Vercel Project ID**:
   ```bash
   vercel projects ls
   ```
2. **Vercel API Token**: 
   - Go to https://vercel.com/dashboard/tokens
   - Create new token
   - Copy the token

### **📊 Lambda Logs (Debugging)**
```bash
# View real-time logs
aws logs tail /aws/lambda/job-scraper --follow

# View recent logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/job-scraper \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)

# Download logs to file
aws logs filter-log-events \
  --log-group-name /aws/lambda/job-scraper \
  --output file > lambda_logs.json
```

### **🗄️ DynamoDB Data (Debugging)**
```bash
# View all jobs
aws dynamodb scan --table-name jobs

# View specific job
aws dynamodb get-item \
  --table-name jobs \
  --key '{"url": {"S": "https://example.com/job/123"}}'

# View all companies
aws dynamodb scan --table-name companies

# Count jobs
aws dynamodb scan --table-name jobs --select COUNT
```

## 🚀 Quick Setup Commands

### **Step 1: Run Complete Setup**
```bash
# Make script executable
chmod +x setup_complete_aws.sh

# Run the complete setup
./setup_complete_aws.sh
```

### **Step 2: Configure Vercel**
```bash
# Get your AWS credentials
AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --output text)
AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --output text)

echo "Add these to Vercel environment variables:"
echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"
echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
echo "AWS_REGION=eu-west-1"
echo "JOBS_TABLE=jobs"
echo "COMPANIES_TABLE=companies"
```

### **Step 3: Update Vercel API Routes**
```bash
# Copy DynamoDB API routes
cp job-watcher-frontend/src/pages/api/jobs-dynamodb.js job-watcher-frontend/src/pages/api/jobs.js
cp job-watcher-frontend/src/pages/api/stats-dynamodb.js job-watcher-frontend/src/pages/api/stats.js

# Deploy to Vercel
cd job-watcher-frontend
vercel --prod
```

## 🧪 Test Everything

### **Test Lambda Function**
```bash
# Trigger manual run
aws lambda invoke --function-name job-scraper --payload '{}' response.json

# Check response
cat response.json
```

### **Test Vercel API**
```bash
# Test jobs API
curl https://your-site.vercel.app/api/jobs

# Test stats API
curl https://your-site.vercel.app/api/stats

# Test with filters
curl "https://your-site.vercel.app/api/jobs?company=Showpad"
curl "https://your-site.vercel.app/api/jobs?search=backend"
```

## 🔍 Troubleshooting

### **Common Issues & Solutions**

#### **1. Lambda Timeout**
```bash
# Check timeout setting
aws lambda get-function-configuration --function-name job-scraper

# Increase timeout if needed
aws lambda update-function-configuration \
  --function-name job-scraper \
  --timeout 1800  # 30 minutes
```

#### **2. DynamoDB Permissions**
```bash
# Check IAM role
aws iam get-role-policy --role-name JobWatcherLambdaRole --policy-name DynamoDBAccess

# Test DynamoDB access
aws dynamodb describe-table --table-name jobs
```

#### **3. Vercel API Errors**
```bash
# Check Vercel logs
vercel logs

# Check environment variables
vercel env ls
```

#### **4. CloudWatch Schedule Issues**
```bash
# Check rule
aws events describe-rule --name job-scraper-schedule

# Check targets
aws events list-targets-by-rule --rule job-scraper-schedule
```

## 📋 Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   AWS Lambda    │───▶│ AWS DynamoDB    │───▶│ Vercel API      │
│  (Job Scraper)  │    │ (Jobs/Companies) │    │ (Database API)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  CloudWatch     │    │   Vercel Build   │    │   Your Website   │
│   (Schedule)    │    │  (Auto Deploy)    │    │  (Real-time)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🎯 What Each Component Does

### **AWS Lambda** (`job-scraper`)
- **Triggers**: Daily at 5 PM UTC
- **Action**: Scrapes 82 companies for jobs
- **Storage**: Saves jobs to DynamoDB
- **Monitoring**: Logs to CloudWatch
- **Cost**: ~$0.20/month

### **AWS DynamoDB** (`jobs` table)
- **Purpose**: Store job listings
- **Access**: Direct from Vercel APIs
- **Performance**: 10ms query time
- **Cost**: ~$1.25/month
- **Scalability**: Millions of requests

### **Vercel API** (`/api/jobs`)
- **Purpose**: Serve jobs to frontend
- **Database**: Queries DynamoDB directly
- **Features**: Search, filtering, pagination
- **Performance**: ~10ms response time

### **Vercel Frontend**
- **Purpose**: Display jobs to users
- **Data Source**: Vercel API routes
- **Features**: Real-time updates, search, filters
- **Deployment**: Automatic on database changes

## 🎉 Complete Workflow

### **Daily Automatic (5 PM UTC)**
1. **CloudWatch** triggers Lambda function
2. **Lambda** scrapes 82 companies in parallel
3. **Lambda** saves new jobs to DynamoDB
4. **Vercel API** serves real-time data to frontend
5. **Users** see updated jobs instantly

### **Manual Updates**
1. **Update companies**: Edit `companies.json`
2. **Update Lambda**: Run deployment script
3. **Update API**: Copy new API routes to Vercel
4. **Deploy**: `vercel --prod`

## 🚀 You're Ready!

**Run this command to start:**
```bash
chmod +x setup_complete_aws.sh
./setup_complete_aws.sh
```

**This will create:**
- ✅ Complete AWS infrastructure
- ✅ Lambda function with DynamoDB integration
- ✅ CloudWatch daily schedule
- ✅ IAM roles and permissions
- ✅ All necessary API routes

**Then just add your AWS credentials to Vercel and deploy!** 🎯
