// Test a specific recording to see artist-credit structure

const MB = require('musicbrainz-api').MusicBrainzApi;

async function testRecording() {
  const mb = new MB({
    appName: 'linr-test',
    appVersion: '1.0.0',
    appContactInfo: 'test@example.com'
  });

  // "Death of a Salesman" by Steve Goodman (should show as Unknown)
  const recordingId = '01ad00cc-0d3c-4ec4-8ca0-7ae3c7184a50';

  console.log('Looking up "Death of a Salesman"...\n');

  try {
    const recording = await mb.lookup('recording', recordingId, ['artist-credits', 'releases']);

    console.log(`Title: ${recording.title}`);
    console.log(`\nArtist-credit structure:`);
    console.log(JSON.stringify(recording['artist-credit'], null, 2));

    console.log(`\nReleases: ${recording.releases?.length || 0}`);
    if (recording.releases && recording.releases.length > 0) {
      console.log('\nFirst release:');
      const firstRelease = recording.releases[0];
      console.log(`  Title: ${firstRelease.title}`);
      console.log(`  Artist: ${firstRelease['artist-credit']?.[0]?.name || 'Unknown'}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testRecording();
