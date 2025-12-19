// Test Swimmer recordings in detail

const MB = require('musicbrainz-api').MusicBrainzApi;

async function testSwimmerRecordings() {
  const mb = new MB({
    appName: 'linr-test',
    appVersion: '1.0.0',
    appContactInfo: 'test@example.com'
  });

  console.log('Searching for Swimmer recordings with full details...\n');

  try {
    // Get one of the Swimmer recordings
    const recordingId = '6a69a927-edbf-494a-8410-92d91c8fea49'; // "Special Life"

    console.log('Looking up "Special Life" by Swimmer...\n');
    const recording = await mb.lookup('recording', recordingId, ['artist-credits', 'artist-rels']);

    console.log(`Title: ${recording.title}`);
    console.log(`ID: ${recording.id}`);
    console.log(`Artist-credit:`, recording['artist-credit']);
    console.log(`\nRelationships: ${recording.relations?.length || 0}`);

    if (recording.relations && recording.relations.length > 0) {
      console.log('\nArtist relationships:');
      recording.relations
        .filter(rel => rel['target-type'] === 'artist')
        .forEach(rel => {
          const artist = rel.artist;
          console.log(`  - ${artist.name} (${artist.id})`);
          console.log(`    Type: ${rel.type}`);
          console.log(`    Attributes: ${rel.attributes?.join(', ') || 'None'}`);
        });
    }

    // Also search for all Swimmer band recordings
    console.log('\n\nSearching for all Swimmer (Maverick) recordings...\n');
    const swimmerSearch = await mb.search('recording', {
      query: 'artist:Swimmer',
      limit: 20
    });

    if (swimmerSearch.recordings && swimmerSearch.recordings.length > 0) {
      console.log(`Found ${swimmerSearch.recordings.length} recordings:\n`);
      swimmerSearch.recordings.slice(0, 10).forEach((rec, i) => {
        console.log(`${i + 1}. "${rec.title}"`);
        console.log(`   Recording ID: ${rec.id}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testSwimmerRecordings();
