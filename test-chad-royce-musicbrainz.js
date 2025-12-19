// Test what MusicBrainz actually returns for Chad Royce

const MB = require('musicbrainz-api').MusicBrainzApi;

async function testChadRoyce() {
  const mb = new MB({
    appName: 'linr-test',
    appVersion: '1.0.0',
    appContactInfo: 'test@example.com'
  });

  console.log('Testing MusicBrainz data for Chad Royce...\n');

  try {
    // First, search for the artist
    console.log('1. Searching for artist "Chad Royce"...');
    const artistSearch = await mb.search('artist', { query: 'Chad Royce', limit: 5 });

    if (artistSearch.artists && artistSearch.artists.length > 0) {
      console.log(`Found ${artistSearch.artists.length} artists:\n`);
      artistSearch.artists.forEach((artist, i) => {
        console.log(`${i + 1}. ${artist.name} (${artist.id})`);
        console.log(`   Score: ${artist.score}`);
        console.log(`   Type: ${artist.type || 'Unknown'}`);
        console.log(`   Disambiguation: ${artist.disambiguation || 'None'}\n`);
      });

      // Use the first result's ID
      const artistId = 'c4ff4e49-c33e-4a93-89ed-956dd76f4d18';
      console.log(`\n2. Looking up artist with recording-rels: ${artistId}\n`);

      const artistWithRels = await mb.lookup('artist', artistId, ['recording-rels', 'aliases']);

      console.log(`Name: ${artistWithRels.name}`);
      console.log(`Aliases: ${artistWithRels.aliases?.map(a => a.name).join(', ') || 'None'}`);
      console.log(`Relations: ${artistWithRels.relations?.length || 0}\n`);

      if (artistWithRels.relations && artistWithRels.relations.length > 0) {
        console.log('First 10 recording relationships:');
        artistWithRels.relations
          .filter(rel => rel['target-type'] === 'recording')
          .slice(0, 10)
          .forEach((rel, i) => {
            const recording = rel.recording;
            console.log(`${i + 1}. "${recording.title}"`);
            console.log(`   Type: ${rel.type || 'Unknown'}`);
            console.log(`   Attributes: ${rel.attributes?.join(', ') || 'None'}`);
            console.log(`   Recording ID: ${recording.id}\n`);
          });
      }

      // Search for recordings with arid (artist ID)
      console.log(`\n3. Searching recordings with arid:${artistId}...\n`);
      const recordingSearch = await mb.search('recording', {
        query: `arid:${artistId}`,
        limit: 10
      });

      if (recordingSearch.recordings && recordingSearch.recordings.length > 0) {
        console.log(`Found ${recordingSearch.recordings.length} recordings:\n`);
        recordingSearch.recordings.forEach((rec, i) => {
          console.log(`${i + 1}. "${rec.title}"`);
          console.log(`   Artist credit: ${rec['artist-credit']?.map(ac => ac.name).join(', ')}`);
          console.log(`   Score: ${rec.score}\n`);
        });
      }

      // Search for "Swimmer" band
      console.log(`\n4. Searching for band "Swimmer"...\n`);
      const swimmerSearch = await mb.search('artist', { query: 'Swimmer', limit: 5 });

      if (swimmerSearch.artists && swimmerSearch.artists.length > 0) {
        swimmerSearch.artists.forEach((artist, i) => {
          console.log(`${i + 1}. ${artist.name} (${artist.id})`);
          console.log(`   Type: ${artist.type || 'Unknown'}`);
          console.log(`   Disambiguation: ${artist.disambiguation || 'None'}\n`);
        });
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testChadRoyce();
