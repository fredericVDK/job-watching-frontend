# 🎯 AWS + Vercel Job Watcher - Complete Architecture

## 📁 Final File Structure

### Local Development (Keep)
```
JobWatcher/
├── lambda_scraper.py          # AWS Lambda function
├── companies.json             # Company list
├── deploy_aws.sh              # AWS deployment script
├── AWS_SETUP.md               # Setup documentation
└── job-watcher-frontend/      # Next.js frontend
    ├── src/pages/api/sync-db.js  # S3 sync API
    ├── src/lib/database.ts        # Database parser
    ├── companies.json             # Company list copy
    ├── jobs.db                    # Database (synced from S3)
    └── ... (other frontend files)
```

### Files Removed (No Longer Needed)
- ❌ `ghent_dynamic_job_watcher_improved.py` - Replaced by Lambda
- ❌ `deploy_database.py` - Replaced by S3 sync
- ❌ `daily_update.bat` - Replaced by CloudWatch
- ❌ `jobwatch.log` - Replaced by CloudWatch logs
- ❌ `test_linkedin.py` - No longer needed
- ❌ `companies_backup.json` - Backup not needed
- ❌ `AUTOMATION_SETUP.md` - Replaced by AWS_SETUP.md
- ❌ `DEPLOYMENT_GUIDE.md` - Replaced by AWS_SETUP.md

## 🏗️ Architecture Flow

```
CloudWatch (5 PM) 
    ↓
AWS Lambda (scraper)
    ↓
AWS S3 (jobs.db)
    ↓
Vercel API (sync-db)
    ↓
Vercel Frontend (website)
```

## 🚀 Deployment Steps

### 1. AWS Setup
```bash
# Deploy to AWS
chmod +x deploy_aws.sh
./deploy_aws.sh
```

### 2. Vercel Environment Variables
Add these to your Vercel project:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (optional, defaults to eu-west-1)
- `S3_BUCKET` (optional, defaults to job-watcher-data)
- `S3_KEY` (optional, defaults to jobs.db)

### 3. Lambda Environment Variables
Add these to your Lambda function:
- `VERCEL_API_TOKEN` - Your Vercel API token
- `VERCEL_PROJECT_ID` - Your Vercel project ID
- `COMPANIES_JSON` - JSON string of companies (optional)

### 4. Test the Flow
```bash
# Test Lambda manually
aws lambda invoke --function-name job-scraper --payload '{}' response.json

# Check logs
aws logs tail /aws/lambda/job-scraper --follow

# Test S3 sync
curl -X POST https://your-vercel-site.vercel.app/api/sync-db
```

## 💰 Cost Breakdown

### AWS (Free Tier)
- **Lambda**: ~$0.20/month (100k requests)
- **S3**: ~$0.02/month (10GB storage)
- **CloudWatch**: ~$0.50/month (logs)
- **Total**: ~$0.72/month

### Vercel (Pro Plan)
- **Vercel**: ~$20/month (for API routes and serverless functions)
- **Total**: ~$20.72/month

## 🎯 Benefits of AWS Architecture

✅ **Serverless** - No servers to manage
✅ **Scalable** - Auto-scales with needs
✅ **Reliable** - 99.99% uptime
✅ **Cost-effective** - Pay only for usage
✅ **Automated** - Runs automatically daily
✅ **Monitoring** - Built-in logging and metrics
✅ **Global** - Deploy to any AWS region
✅ **Secure** - IAM roles and policies
✅ **Fast** - Edge caching with Vercel

## 🔄 Daily Workflow (Automated)

1. **5:00 PM UTC** - CloudWatch triggers Lambda
2. **Lambda** scrapes all companies (parallel processing)
3. **Lambda** uploads jobs.db to S3
4. **Lambda** triggers Vercel deployment webhook
5. **Vercel** calls sync-db API
6. **Vercel** downloads jobs.db from S3
7. **Vercel** rebuilds and deploys site
8. **Website** updates with new jobs

## 🛠️ Maintenance

### Update Companies
```bash
# Update companies.json locally
# Then update Lambda
aws lambda update-function-configuration \
  --function-name job-scraper \
  --environment Variables='{S3_BUCKET=job-watcher-data,S3_KEY=jobs.db,COMPANIES_JSON=$(cat companies.json | jq -c .)}'
```

### Update Scraper Logic
```bash
# Update lambda_scraper.py
# Then redeploy
zip lambda_scraper.zip lambda_scraper.py
aws lambda update-function-code \
  --function-name job-scraper \
  --zip-file fileb://lambda_scraper.zip
```

### Monitor Performance
```bash
# View logs
aws logs tail /aws/lambda/job-scraper --follow

# View metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=job-scraper \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average
```

## 🚨 Troubleshooting

### Common Issues
1. **Lambda timeout** - Increase timeout or reduce companies
2. **S3 permissions** - Check IAM role policies
3. **Vercel sync** - Check environment variables
4. **Memory issues** - Increase Lambda memory

### Debug Commands
```bash
# Check Lambda configuration
aws lambda get-function-configuration --function-name job-scraper

# Check S3 bucket
aws s3 ls s3://job-watcher-data

# Test Vercel API
curl -X POST https://your-site.vercel.app/api/sync-db
```

## 🎉 You're Ready!

Your Job Watcher is now:
- ✅ **Cloud-native** with AWS Lambda
- ✅ **Serverless** with no infrastructure to manage
- ✅ **Automated** with daily runs
- ✅ **Scalable** for future growth
- ✅ **Cost-effective** at ~$21/month
- ✅ **Reliable** with 99.99% uptime

**Next Steps:**
1. Run `./deploy_aws.sh` to set up AWS
2. Configure Vercel environment variables
3. Test the complete workflow
4. Enjoy your automated job hunting system! 🚀
