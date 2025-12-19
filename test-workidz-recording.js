// Test one of the "Workidz" recordings to see why it's attributed to Chad Royce

const MB = require('musicbrainz-api').MusicBrainzApi;

async function testWorkidzRecording() {
  const mb = new MB({
    appName: 'linr-test',
    appVersion: '1.0.0',
    appContactInfo: 'test@example.com'
  });

  console.log('Checking "Workidz" recording attribution...\n');

  try {
    // Search for one of the problematic recordings
    const recordingSearch = await mb.search('recording', {
      query: 'title:"Workids Orchids" AND artist:"The Baghdaddies"',
      limit: 1
    });

    if (recordingSearch.recordings && recordingSearch.recordings.length > 0) {
      const rec = recordingSearch.recordings[0];
      console.log('Recording found:');
      console.log(`Title: ${rec.title}`);
      console.log(`ID: ${rec.id}`);
      console.log(`Artist-credit:`, rec['artist-credit']);
      console.log();

      // Look up the full recording with relationships
      const fullRec = await mb.lookup('recording', rec.id, ['artist-credits', 'releases']);

      console.log('Full artist-credit details:');
      console.log(JSON.stringify(fullRec['artist-credit'], null, 2));
    }

    // Also search for recordings with Chad Royce in artist-credit
    console.log('\n\nSearching for recordings with "Chad Royce" in artist-credit...\n');
    const chadSearch = await mb.search('recording', {
      query: 'artistname:"Chad Royce"',
      limit: 5
    });

    if (chadSearch.recordings && chadSearch.recordings.length > 0) {
      console.log(`Found ${chadSearch.recordings.length} recordings:\n`);
      chadSearch.recordings.forEach((rec, i) => {
        console.log(`${i + 1}. "${rec.title}"`);
        console.log(`   Artist-credit:`, rec['artist-credit']?.map(ac => typeof ac === 'string' ? ac : ac.name).join(', '));
        console.log();
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testWorkidzRecording();
