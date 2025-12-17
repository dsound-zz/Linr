/**
 * Inspect raw relations to understand the data structure
 */

const BASE_URL = 'http://localhost:3000';

async function inspectRelations() {
  console.log('=== Inspecting Raw Relations ===\n');

  const searchRes = await fetch(`${BASE_URL}/api/search?q=since u been gone`);
  const searchData = await searchRes.json();
  const firstResult = searchData.results[0];

  const recordingRes = await fetch(`${BASE_URL}/api/recording?id=${firstResult.id}`);
  const recordingData = await recordingRes.json();

  if (recordingData._rawRelations) {
    console.log(`Total relations: ${recordingData._rawRelations.length}\n`);

    // Find Max Martin relations
    const maxMartinRels = recordingData._rawRelations.filter(rel =>
      rel.artist && rel.artist.name && rel.artist.name.toLowerCase().includes('max martin')
    );

    console.log(`Max Martin relations: ${maxMartinRels.length}\n`);

    maxMartinRels.forEach((rel, i) => {
      console.log(`\n--- Relation ${i + 1} ---`);
      console.log(JSON.stringify(rel, null, 2));
    });
  }
}

inspectRelations().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
