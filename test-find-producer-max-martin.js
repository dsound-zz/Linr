/**
 * Test to find the correct Max Martin (the famous producer)
 */

const BASE_URL = 'http://localhost:3000';

async function findProducerMaxMartin() {
  console.log('=== Finding Producer Max Martin ===\n');

  // Search for a song we know Max Martin produced
  const searchQuery = 'since u been gone';
  console.log(`Searching for "${searchQuery}"...`);

  const searchRes = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(searchQuery)}`);
  const searchData = await searchRes.json();

  const firstResult = searchData.results[0];
  console.log(`Found: "${firstResult.title}" by ${firstResult.artist}`);
  console.log(`Recording ID: ${firstResult.id}\n`);

  // Get recording details
  const recordingRes = await fetch(`${BASE_URL}/api/recording?id=${firstResult.id}`);
  const recordingData = await recordingRes.json();

  console.log('Credits:');
  console.log('  Producers:', recordingData.credits.producers);
  console.log('  Writers:', recordingData.credits.writers);

  if (recordingData._rawRelations) {
    console.log(`\nFound ${recordingData._rawRelations.length} raw relations`);
    console.log('\nSearching for Max Martin in raw relations...\n');

    // Find ALL Max Martin entries
    const maxMartins = [];
    for (const rel of recordingData._rawRelations) {
      if (rel.artist && rel.artist.name && rel.artist.name.toLowerCase().includes('max martin')) {
        const attributes = rel['attribute-values'] || rel.attributes;
        const roleStr = Array.isArray(attributes) ? attributes.join(', ') : (attributes || 'unknown');
        maxMartins.push({
          name: rel.artist.name,
          mbid: rel.artist.id,
          type: rel.type,
          role: roleStr
        });
      }
    }

    console.log(`Found ${maxMartins.length} Max Martin entries:`);
    maxMartins.forEach((mm, i) => {
      console.log(`\n${i + 1}. Name: ${mm.name}`);
      console.log(`   MBID: ${mm.mbid}`);
      console.log(`   Type: ${mm.type}`);
      console.log(`   Role: ${mm.role}`);
    });

    // Test each MBID
    console.log('\n=== Testing each MBID ===');
    for (const mm of maxMartins) {
      console.log(`\nTesting ${mm.name} (${mm.mbid})...`);
      const testUrl = `${BASE_URL}/api/contributor?name=${encodeURIComponent(mm.name)}&mbid=${mm.mbid}&limit=5&offset=0`;
      const testRes = await fetch(testUrl);
      const testData = await testRes.json();
      console.log(`  Total recordings: ${testData.totalRecordings}`);
      if (testData.contributions && testData.contributions.length > 0) {
        console.log(`  First song: "${testData.contributions[0].title}" by ${testData.contributions[0].artist}`);
      }
    }
  }
}

findProducerMaxMartin().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
