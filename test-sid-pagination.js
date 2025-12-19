// Test Sid Sims pagination

async function testPagination() {
  console.log('Testing Sid Sims pagination...\n');

  try {
    // First page
    console.log('=== First page (offset=0) ===');
    const page1 = await fetch(
      'http://localhost:3000/api/contributor?name=Sid+Sims&limit=20&offset=0&mbid=090f4464-a4d8-4a56-8446-92d44752a9de'
    );
    const data1 = await page1.json();
    console.log(`Contributions: ${data1.contributions?.length || 0}`);
    console.log(`Total recordings: ${data1.totalRecordings}`);
    console.log(`Has more: ${data1.hasMore}`);

    // Second page
    console.log('\n=== Second page (offset=20) ===');
    const page2 = await fetch(
      'http://localhost:3000/api/contributor?name=Sid+Sims&limit=20&offset=20&mbid=090f4464-a4d8-4a56-8446-92d44752a9de'
    );
    const data2 = await page2.json();
    console.log(`Contributions: ${data2.contributions?.length || 0}`);
    console.log(`Total recordings: ${data2.totalRecordings}`);
    console.log(`Has more: ${data2.hasMore}`);

    if (data2.contributions && data2.contributions.length > 0) {
      console.log('\nSecond page contributions:');
      data2.contributions.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.title} - ${c.artist}`);
      });
    } else {
      console.log('\n⚠️  No contributions returned on second page!');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testPagination();
