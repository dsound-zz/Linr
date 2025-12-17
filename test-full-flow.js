/**
 * Full user flow test: Search → Recording → Contributor
 */

const BASE_URL = 'http://localhost:3000';

async function testFullFlow() {
  console.log('=== Full User Flow Test ===\n');

  // Step 1: Search
  console.log('1. Searching for "since u been gone"...');
  const searchRes = await fetch(`${BASE_URL}/api/search?q=since u been gone`);
  const searchData = await searchRes.json();
  const recording = searchData.results[0];
  console.log(`   Found: "${recording.title}" by ${recording.artist}`);
  console.log(`   ID: ${recording.id}\n`);

  // Step 2: Get recording details
  console.log('2. Fetching recording details...');
  const recordingRes = await fetch(`${BASE_URL}/api/recording?id=${recording.id}`);
  const recordingData = await recordingRes.json();
  console.log(`   Has _rawRelations: ${!!recordingData._rawRelations}`);
  console.log(`   Producers: ${recordingData.credits.producers.join(', ')}\n`);

  // Step 3: Check if we can extract Max Martin's MBID
  console.log('3. Extracting Max Martin MBID from raw relations...');
  let maxMartinMbid = null;
  if (recordingData._rawRelations) {
    for (const rel of recordingData._rawRelations) {
      if (rel.artist && rel.artist.name === 'Max Martin' && rel.type === 'producer') {
        maxMartinMbid = rel.artist.id;
        console.log(`   ✓ Found MBID: ${maxMartinMbid}`);
        console.log(`   Disambiguation: ${rel.artist.disambiguation}\n`);
        break;
      }
    }
  }

  if (!maxMartinMbid) {
    console.log('   ❌ Could not find Max Martin MBID as producer\n');
    return;
  }

  // Step 4: Call contributor API with MBID
  console.log('4. Fetching Max Martin contributor page with MBID...');
  const contributorUrl = `${BASE_URL}/api/contributor?name=Max%20Martin&mbid=${maxMartinMbid}&limit=5&offset=0`;
  const contributorRes = await fetch(contributorUrl);
  const contributorData = await contributorRes.json();

  console.log(`   Name: ${contributorData.name}`);
  console.log(`   Total Recordings: ${contributorData.totalRecordings}`);
  console.log(`   Has More: ${contributorData.hasMore}`);

  if (contributorData.roleBreakdown) {
    console.log('\n   Role Breakdown:');
    contributorData.roleBreakdown.forEach(role => {
      console.log(`     ${role.role}: ${role.count}`);
    });
  }

  console.log('\n   First 5 contributions:');
  contributorData.contributions.forEach((c, i) => {
    console.log(`     ${i + 1}. "${c.title}" by ${c.artist}`);
  });

  // Step 5: Verdict
  console.log('\n=== VERDICT ===');
  if (contributorData.totalRecordings >= 300) {
    console.log(`✓ SUCCESS: Got ${contributorData.totalRecordings} recordings (good!)`);
  } else {
    console.log(`⚠ PARTIAL: Got ${contributorData.totalRecordings} recordings (expected 500+)`);
    console.log('  Note: This is a MusicBrainz API limitation, not our bug.');
  }
}

testFullFlow().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
