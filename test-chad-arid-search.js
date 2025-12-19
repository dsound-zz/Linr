// Test what arid: search returns for Chad Royce

const MB = require('musicbrainz-api').MusicBrainzApi;

async function testAridSearch() {
  const mb = new MB({
    appName: 'linr-test',
    appVersion: '1.0.0',
    appContactInfo: 'test@example.com'
  });

  const artistId = 'c4ff4e49-c33e-4a93-89ed-956dd76f4d18';
  console.log(`Searching recordings with arid:${artistId}...\n`);

  try {
    const recordingSearch = await mb.search('recording', {
      query: `arid:${artistId}`,
      limit: 50
    });

    console.log(`Found ${recordingSearch.recordings?.length || 0} recordings\n`);

    if (recordingSearch.recordings && recordingSearch.recordings.length > 0) {
      console.log('Recordings:');
      recordingSearch.recordings.forEach((rec, i) => {
        console.log(`${i + 1}. "${rec.title}"`);
        const artistCredit = rec['artist-credit']?.map(ac =>
          typeof ac === 'string' ? ac : ac.name
        ).join(', ') || 'Unknown';
        console.log(`   Artist: ${artistCredit}`);
        console.log(`   Score: ${rec.score}`);
        console.log();
      });
    } else {
      console.log('No recordings found with arid: search!');
      console.log('This means recordings are coming from somewhere else (work queries or recording-rels)');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testAridSearch();
