import pages from './pages.json';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import got from 'got';

// There are some duplicates from HTTPArchive. I guess it's pages that also fetched themselves?
const urls = new Set(pages.map(({ page }) => page));
// Just to shut JSDOM up 😀
const virtualConsole = new VirtualConsole();

// Results
const found: string[] = [];
const errors: [url: string, err: string][] = [];

(async () => {
  const total = urls.size;
  let done = 0;

  function writeOutput() {
    fs.writeFileSync('pass-1-found.json', JSON.stringify(found, null, '  '));
    fs.writeFileSync('pass-1-errors.json', JSON.stringify(errors, null, '  '));
  }

  function onSigInt() {
    for (const url of urls) {
      errors.push([url, `Cancelled before complete`]);
    }
    writeOutput();
    process.exit(0);
  }

  process.on('SIGINT', onSigInt);

  // This is a really stupid way to do queuing, but I didn't have any luck with other methods.
  const groups = 10;
  const urlsArray = [...urls];
  const groupSize = Math.ceil(urlsArray.length / groups);
  const urlGroups = Array.from({ length: groups }, (_, i) =>
    urlsArray.slice(groupSize * i, groupSize * (i + 1)),
  );

  const tasks = urlGroups.map(async (urlGroup) => {
    for (const url of urlGroup) {
      try {
        console.log('Fetching', url);

        // Fetch the source
        let source;
        try {
          source = await got(url, { timeout: 30 * 1000 }).text();
        } catch (err) {
          const error: [string, string] = [url, `Fetch failed: ${err.message}`];
          errors.push(error);
          console.log(error);
          continue;
        }

        console.log('Fetched', url);

        // Parse the source
        let dom: JSDOM;
        try {
          dom = new JSDOM(source, { url, virtualConsole });
        } catch (err) {
          errors.push([url, `JSDOM failed: ${err.message}`]);
          continue;
        }

        // Find <source>s with srcset but not sizes
        const candidateSources = [
          ...dom.window.document.querySelectorAll(
            'source[srcset]:not([sizes])',
          ),
        ];

        // Get unique <picture>s
        const candidatePictures = [
          ...new Set(
            candidateSources
              .map((el) => el.closest('picture'))
              .filter((el): el is HTMLPictureElement => !!el),
          ),
        ];

        // Filter by ones that have an <img> with sizes that isn't just '100vw'
        const matchingPictures = candidatePictures.filter((el) => {
          const img = el.querySelector('img');
          return img && img.sizes && img.sizes !== '100vw';
        });

        if (matchingPictures.length > 0) found.push(url);
      } finally {
        urls.delete(url);
        done++;
        console.log(`Done`, done, `of`, total);
      }
    }
  });

  await Promise.all(tasks);

  process.off('SIGINT', onSigInt);

  writeOutput();
})();
