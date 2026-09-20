// Focused map configuration checks: node tests/webLeaflet.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = fs.readFileSync(path.join(__dirname, '../public/index.md'), 'utf8');
const names = ['default', 'red', 'green', 'blue', 'orange', 'yellow', 'violet', 'grey', 'black'];
const fills = ['#2a81cb', '#cb2b3e', '#2aad27', '#2a81cb', '#e98125', '#f2c218', '#9c2bcb', '#777777', '#333333'];
const markers = names.map((icon, i) => ({ lat: 38 + i / 10, lon: -8, icon, popup: `<b>${icon}</b>` }));
markers.push({ lat: 0, lon: 0 }, { lat: 90, lon: -180, icon: 'unknown' },
  { lat: -90, lon: 180, icon: '"><script>alert(1)</script>' },
  { lat: 1, lon: 2, icon: '__proto__' });
const validCount = markers.length;
markers.push(null, {}, { lat: '40', lon: -8 }, { lat: 91, lon: 0 }, { lat: 0, lon: -181 });
const config = { center: [39.5, -8], zoom: 7, markers, options: { scrollWheelZoom: false, dragging: false } };
let container;
const maps = [];
const block = { textContent: JSON.stringify(config), dataset: {}, parentElement: {
  replaceWith(value) { container = value; }
} };
const context = {
  console, requestAnimationFrame: fn => fn(),
  document: { createElement: () => ({ attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; }
  }) },
  resultsDiv: { querySelectorAll: selector => selector.startsWith('pre') ? [block] : [container] },
  L: {
    divIcon: options => options,
    map: () => {
      const map = { pins: [], setView() { return this; }, remove() { this.removed = true; },
        scrollWheelZoom: { disable() {} }, dragging: { disable() {} } };
      maps.push(map);
      return map;
    },
    tileLayer: () => ({ addTo() {} }),
    marker: (position, options) => ({ position, options,
      addTo(map) { map.pins.push(this); return this; },
      bindPopup(popup) { this.popup = popup; }
    })
  }
};
vm.createContext(context);
vm.runInContext(page.slice(page.indexOf('    function addLeafletMarkers('), page.indexOf('    function configureChartDefaults(')), context);
context.renderLeafletMaps();
assert.equal(block.dataset.leafletRendered, 'true');
assert.equal(container.getAttribute('data-leaflet-config'), block.textContent);
function checkPins(map) {
  assert.equal(map.pins.length, validCount, 'Valid zero coordinates survive; invalid coordinates are skipped');
  map.pins.forEach((pin, i) => {
    assert.ok(pin.options.icon.html.includes(`fill="${fills[i] || fills[0]}"`), `Marker ${i} has requested or fallback color`);
    assert.equal(pin.options.icon.className, 'mini-a-map-pin');
    assert.ok(!pin.options.icon.html.includes('<script>'));
    assert.equal(pin.options.icon.shadowUrl, undefined, 'SVG pins do not load image shadows');
    assert.equal(pin.popup, markers[i].popup);
  });
}
checkPins(maps[0]);
context.reRenderLeafletMaps();
assert.equal(maps[0].removed, true);
checkPins(maps[1]);
assert.deepEqual(maps[1].pins.map(p => p.options.icon.html), maps[0].pins.map(p => p.options.icon.html), 'Theme rebuild preserves colors');
context.addLeafletMarkers(maps[1], [ { lat: NaN, lon: 1 }, { lat: 1, lon: Infinity } ]);
assert.equal(maps[1].pins.length, validCount);
context.addLeafletMarkers(maps[1], undefined);
console.log('Leaflet marker colors, fallbacks, coordinates, popups, and theme rebuild checks passed.');
