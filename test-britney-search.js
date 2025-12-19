// Test search for "hit me baby one more time"

async function testSearch() {
  console.log('Testing search for "hit me baby one more time"...\n');

  try {
    const response = await fetch(
      'http://localhost:3000/api/search?q=' + encodeURIComponent('hit me baby one more time')
    );

    const data = await response.json();

    console.log(`Results found: ${data.recordings?.length || 0}\n`);

    if (data.recordings && data.recordings.length > 0) {
      console.log('First 10 recordings:');
      data.recordings.slice(0, 10).forEach((rec, i) => {
        console.log(`${i + 1}. "${rec.title}" - ${rec.artist} (${rec.year || 'Unknown'})`);
        console.log(`   Score: ${rec.score || 'N/A'}`);
      });

      // Check if Britney Spears is in the results
      const britneyResult = data.recordings.find(r =>
        r.artist && r.artist.toLowerCase().includes('britney')
      );

      if (britneyResult) {
        const index = data.recordings.indexOf(britneyResult);
        console.log(`\n✓ Britney Spears found at position ${index + 1}`);
        console.log(`  "${britneyResult.title}" - ${britneyResult.artist} (${britneyResult.year})`);
      } else {
        console.log('\n✗ Britney Spears NOT found in results');
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testSearch();
