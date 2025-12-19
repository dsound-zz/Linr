// Test Swimmer band and Chad Royce membership

const MB = require('musicbrainz-api').MusicBrainzApi;

async function testSwimmer() {
  const mb = new MB({
    appName: 'linr-test',
    appVersion: '1.0.0',
    appContactInfo: 'test@example.com'
  });

  console.log('Searching for Swimmer band and Chad Royce membership...\n');

  try {
    // Search for Swimmer band
    const swimmerSearch = await mb.search('artist', {
      query: 'Swimmer AND type:Group',
      limit: 5
    });

    if (swimmerSearch.artists && swimmerSearch.artists.length > 0) {
      console.log(`Found ${swimmerSearch.artists.length} Swimmer groups:\n`);

      for (const artist of swimmerSearch.artists) {
        console.log(`${artist.name} (${artist.id})`);
        console.log(`  Type: ${artist.type}`);
        console.log(`  Disambiguation: ${artist.disambiguation || 'None'}\n`);

        // Look up the band with member relationships
        try {
          const bandDetails = await mb.lookup('artist', artist.id, ['artist-rels']);

          console.log(`  Relationships: ${bandDetails.relations?.length || 0}`);

          if (bandDetails.relations) {
            const members = bandDetails.relations.filter(rel =>
              rel.type === 'member of band' || rel['target-type'] === 'artist'
            );

            if (members.length > 0) {
              console.log(`  Members:`);
              members.forEach(rel => {
                const memberName = rel.artist?.name || 'Unknown';
                const memberType = rel.type || 'Unknown relation';
                console.log(`    - ${memberName} (${memberType})`);
              });
            }
          }
          console.log();
        } catch (err) {
          console.error(`  Error looking up band: ${err.message}\n`);
        }
      }
    }

    // Also search for recordings by Swimmer
    console.log('\nSearching for recordings by Swimmer...\n');
    const recordingSearch = await mb.search('recording', {
      query: 'artist:Swimmer',
      limit: 10
    });

    if (recordingSearch.recordings && recordingSearch.recordings.length > 0) {
      console.log(`Found ${recordingSearch.recordings.length} recordings:\n`);
      recordingSearch.recordings.forEach((rec, i) => {
        console.log(`${i + 1}. "${rec.title}"`);
        console.log(`   Artist: ${rec['artist-credit']?.map(ac => ac.name).join(', ')}`);
        console.log(`   ID: ${rec.id}\n`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testSwimmer();
