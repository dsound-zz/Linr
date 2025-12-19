// Test full response from contributor API

async function test() {
  console.log('Fetching full Chad Royce profile...\n');

  try {
    const response = await fetch(
      'http://localhost:3000/api/contributor?name=Chad+Royce&limit=50&offset=0&mbid=c4ff4e49-c33e-4a93-89ed-956dd76f4d18',
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
      console.log('All contributions:');
      data.contributions.forEach((contrib, i) => {
        console.log(`${i + 1}. "${contrib.title}" - ${contrib.artist || 'Unknown'} (${contrib.releaseDate || 'Unknown date'})`);
        if (contrib.roles && contrib.roles.length > 0) {
          console.log(`   Roles: ${contrib.roles.join(', ')}`);
        }
      });
    }

    // Check role breakdown
    if (data.roleBreakdown && data.roleBreakdown.length > 0) {
      console.log('\nRole Breakdown:');
      data.roleBreakdown.forEach(role => {
        console.log(`  ${role.role}: ${role.count}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
