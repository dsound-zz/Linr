/**
 * Test script to verify Max Martin contributor results
 *
 * This test:
 * 1. Searches for a song where Max Martin is credited
 * 2. Gets the recording details to extract Max Martin's MBID
 * 3. Calls the contributor API with the MBID
 * 4. Checks how many results we get
 */

const BASE_URL = 'http://localhost:3000';

async function testMaxMartin() {
  console.log('=== Testing Max Martin Contributor Results ===\n');

  // Step 1: Search for a song
  const searchQuery = 'since u been gone';
  console.log(`Step 1: Searching for "${searchQuery}"...`);

  const searchRes = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(searchQuery)}`);
  const searchData = await searchRes.json();

  if (!searchData.results || searchData.results.length === 0) {
    console.error('❌ No search results found');
    return;
  }

  const firstResult = searchData.results[0];
  console.log(`✓ Found: "${firstResult.title}" by ${firstResult.artist}`);
  console.log(`  Recording ID: ${firstResult.id}\n`);

  // Step 2: Get recording details
  console.log('Step 2: Fetching recording details...');
  const recordingRes = await fetch(`${BASE_URL}/api/recording?id=${firstResult.id}`);
  const recordingData = await recordingRes.json();

  if (!recordingData || !recordingData.credits) {
    console.error('❌ No recording data found');
    return;
  }

  console.log('✓ Recording data loaded');
  console.log(`  Has _rawRelations: ${!!recordingData._rawRelations}`);

  // Find Max Martin in the credits
  let maxMartinMbid = null;
  let maxMartinName = null;

  if (recordingData._rawRelations && Array.isArray(recordingData._rawRelations)) {
    console.log(`  Found ${recordingData._rawRelations.length} raw relations`);

    for (const rel of recordingData._rawRelations) {
      if (rel.artist && rel.artist.name) {
        const artistName = rel.artist.name.toLowerCase();
        if (artistName.includes('max martin')) {
          maxMartinMbid = rel.artist.id;
          maxMartinName = rel.artist.name;
          console.log(`  ✓ Found Max Martin: ${maxMartinName}`);
          console.log(`    MBID: ${maxMartinMbid}`);
          console.log(`    Role: ${rel.type || 'unknown'}\n`);
          break;
        }
      }
    }
  }

  if (!maxMartinMbid) {
    console.error('❌ Could not find Max Martin MBID in raw relations');
    console.log('\nAvailable producers:', recordingData.credits.producers);
    console.log('Available writers:', recordingData.credits.writers);
    return;
  }

  // Step 3: Call contributor API with MBID
  console.log('Step 3: Calling contributor API with MBID...');
  const contributorUrl = `${BASE_URL}/api/contributor?name=${encodeURIComponent(maxMartinName)}&mbid=${maxMartinMbid}&limit=20&offset=0`;
  console.log(`  URL: ${contributorUrl}\n`);

  const contributorRes = await fetch(contributorUrl);
  const contributorData = await contributorRes.json();

  // Step 4: Analyze results
  console.log('=== RESULTS ===');
  console.log(`Name: ${contributorData.name}`);
  console.log(`Total Contributions: ${contributorData.totalContributions}`);
  console.log(`Total Recordings: ${contributorData.totalRecordings}`);
  console.log(`Has More: ${contributorData.hasMore}`);
  console.log(`Contributions in this page: ${contributorData.contributions?.length || 0}`);

  if (contributorData.roleBreakdown) {
    console.log('\nRole Breakdown:');
    contributorData.roleBreakdown.forEach(role => {
      console.log(`  ${role.role}: ${role.count}`);
    });
  }

  console.log('\n=== VERDICT ===');
  if (contributorData.totalRecordings < 100) {
    console.log('❌ ISSUE CONFIRMED: Max Martin should have hundreds of credits, but only got:', contributorData.totalRecordings);

    // Additional debugging: Check what MusicBrainz actually returns for this artist
    console.log('\n=== DEBUGGING: Direct MusicBrainz Query ===');
    console.log('Checking MusicBrainz API directly for this artist ID...');
    const mbUrl = `https://musicbrainz.org/ws/2/recording?artist=${maxMartinMbid}&limit=100&fmt=json`;
    console.log(`MusicBrainz URL: ${mbUrl}`);

    try {
      const mbRes = await fetch(mbUrl, {
        headers: {
          'User-Agent': 'LinrApp/1.0 (development)'
        }
      });
      const mbData = await mbRes.json();
      console.log(`MusicBrainz returned: ${mbData.recordings?.length || 0} recordings`);
      console.log(`MusicBrainz count: ${mbData['recording-count'] || 'unknown'}`);

      if (mbData.recordings && mbData.recordings.length > 0) {
        console.log('\nFirst 3 recordings from MusicBrainz:');
        mbData.recordings.slice(0, 3).forEach((rec, i) => {
          console.log(`  ${i + 1}. ${rec.title}`);
        });
      }
    } catch (err) {
      console.log('Failed to query MusicBrainz:', err.message);
    }
  } else {
    console.log('✓ SUCCESS: Got', contributorData.totalRecordings, 'recordings');
  }
}

testMaxMartin().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
