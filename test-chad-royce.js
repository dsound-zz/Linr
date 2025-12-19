// Test Chad Royce search timeout issue

async function testChadRoyce() {
  console.log('Testing Chad Royce contributor API...\n');

  const startTime = Date.now();

  try {
    const response = await fetch(
      'http://localhost:3000/api/contributor?name=Chad+Royce&limit=20&offset=0&mbid=c4ff4e49-c33e-4a93-89ed-956dd76f4d18',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const duration = Date.now() - startTime;

    if (!response.ok) {
      console.error(`HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      return;
    }

    const data = await response.json();

    console.log(`✓ Request completed in ${duration}ms\n`);
    console.log(`Name: ${data.name}`);
    console.log(`Total contributions: ${data.totalContributions}`);
    console.log(`Total recordings: ${data.totalRecordings}`);
    console.log(`Recordings returned: ${data.recordings?.length || 0}\n`);

    if (data.recordings && data.recordings.length > 0) {
      console.log('First 5 recordings:');
      data.recordings.slice(0, 5).forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec.title} - ${rec.artistCredit || 'Unknown'}`);
      });
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`✗ Request failed after ${duration}ms`);
    console.error(error.message);
  }
}

testChadRoyce();
