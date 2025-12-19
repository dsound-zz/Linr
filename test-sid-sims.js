// Test Sid Sims to see the "Unknown Artist" issue

async function testSidSims() {
  console.log('Fetching Sid Sims profile...\n');

  try {
    const response = await fetch(
      'http://localhost:3000/api/contributor?name=Sid+Sims&limit=20&offset=0',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();

    console.log(`Total recordings: ${data.totalRecordings}`);
    console.log(`Contributions in response: ${data.contributions?.length || 0}\n`);

    if (data.contributions && data.contributions.length > 0) {
      console.log('Contributions with "Unknown Artist":');
      data.contributions
        .filter(c => c.artist === 'Unknown Artist' || c.artist === 'Unknown')
        .forEach((contrib, i) => {
          console.log(`${i + 1}. "${contrib.title}" - ${contrib.artist}`);
          console.log(`   Recording ID: ${contrib.recordingId}`);
        });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testSidSims();
