const fs = require('fs');
const path = require('path');

// Database path - use the deployed database (same directory)
const DB_PATH = path.join(process.cwd(), 'jobs.db');

// Debug function to examine database content
function debugDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.log('❌ Database file not found at:', DB_PATH);
      return;
    }

    const buffer = fs.readFileSync(DB_PATH);
    const text = buffer.toString('utf8');
    
    console.log('📊 Database size:', buffer.length, 'bytes');
    console.log('🔍 First 1000 characters:');
    console.log(text.substring(0, 1000));
    console.log('\n🔍 Looking for INSERT statements...');
    
    const lines = text.split('\n');
    let insertCount = 0;
    let jobCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('INSERT INTO seen_jobs')) {
        insertCount++;
        console.log(`\n📝 INSERT statement #${insertCount}:`);
        console.log(line.substring(0, 200) + '...');
        
        // Try to extract data
        const match = line.match(/VALUES\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
        
        if (match) {
          jobCount++;
          console.log(`✅ Extracted job #${jobCount}:`);
          console.log(`   URL: ${match[1]}`);
          console.log(`   Company: ${match[2]}`);
          console.log(`   Title: ${match[3]}`);
          console.log(`   Location: ${match[4]}`);
          console.log(`   Date: ${match[6]}`);
        } else {
          console.log('❌ Failed to extract data from INSERT statement');
        }
      }
    }
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total INSERT statements found: ${insertCount}`);
    console.log(`   Jobs successfully extracted: ${jobCount}`);
    
    // Also look for URLs in the file
    console.log('\n🔍 Looking for URLs in database...');
    const urlRegex = /(https?:\/\/[^\s'"]+)/g;
    const urls = text.match(urlRegex) || [];
    console.log(`Found ${urls.length} URLs in database`);
    urls.slice(0, 5).forEach((url, i) => console.log(`   ${i+1}. ${url}`));
    
  } catch (error) {
    console.error('❌ Error reading database:', error);
  }
}

// Run the debug function
debugDatabase();
