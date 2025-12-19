// Test Chad Royce with offset=20

async function test() {
  console.log('Testing Chad Royce with offset=20...\n');

  const startTime = Date.now();

  try {
    const response = await fetch(
      'http://localhost:3000/api/contributor?name=Chad+Royce&limit=20&offset=20&mbid=c4ff4e49-c33e-4a93-89ed-956dd76f4d18',
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
      return;
    }

    const data = await response.json();

    console.log(`✓ Request completed in ${duration}ms\n`);
    console.log(`Recordings returned: ${data.recordings?.length || 0}`);

    if (data.recordings && data.recordings.length > 0) {
      console.log('\nRecordings:');
      data.recordings.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec.title}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
