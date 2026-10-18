const NETWORK_CYCLONE_SIZE_PX=24;
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgElement(kind, attrs = {}) {
    const node = document.createElementNS(SVG_NS, kind);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
}
function networkGeographicGlyph(map, at, renderer, make, options = {}) {
    const anchor = L.circleMarker(at, { renderer, radius: options.radius ?? 1, stroke: false,
        fill: options.interactive ?? false, opacity: 0, fillOpacity: 0.001, interactive: options.interactive ?? false });
    const update = anchor._updatePath.bind(anchor);
    anchor._updatePath = () => {
        update();
        const path = anchor._path;
        const pos = anchor._point;
        if (!path || !pos)
            return;
        // Leaflet creates the SVG <path> before it inserts that path into its SVG
        // renderer. The first _updatePath can therefore run while parentNode is
        // null. Do not record a detached glyph as if it were already rendered.
        const parent = path.parentNode;
        if (!parent)
            return;
        if (!anchor._networkGlyph) {
            anchor._networkGlyph = svgElement('g', { 'class': 'tn-geo-glyph' });
        }
        // SVG renderer / pane reinitialization can replace the original parent.
        // Reattach on every draw instead of keeping a permanently orphaned <g>.
        if (anchor._networkGlyph.parentNode !== parent)
            parent.appendChild(anchor._networkGlyph);
        make(pos, anchor._networkGlyph);
    };
    anchor.on('remove', () => { anchor._networkGlyph?.remove(); anchor._networkGlyph = undefined; });
    anchor.addTo(map);
    // On real Leaflet's first add, CircleMarker._updatePath runs before SVG._addPath
    // inserts the <path> into _rootGroup. Force a *post-insertion* draw so both
    // the cyclone icon and all CMA lead-time labels appear on initial map entry.
    anchor._updatePath?.();
    return anchor;
}
function geographicLead(map, at, renderer, lead, force) {
    const caption = `${Math.round(lead)}h/${Math.round(force)}级${force >= 17 ? '以上' : ''}`;
    return networkGeographicGlyph(map, at, renderer, (point, group) => {
        let text = group.firstElementChild;
        if (!text) {
            text = svgElement('text', { 'class': 'tn-geo-lead', 'paint-order': 'stroke fill',
                'stroke-linejoin': 'round', 'font-size': '9', 'font-weight': '500',
                'font-family': "Arial,'Microsoft YaHei',sans-serif", 'fill': '#fff',
                'stroke': '#292929', 'stroke-width': '0.7', 'pointer-events': 'none' });
            text.textContent = caption;
            group.appendChild(text);
        }
        text.setAttribute('x', String(point.x - 26));
        text.setAttribute('y', String(point.y + 16));
    });
}
function geographicCyclone(map, at, renderer, fix) {
    return networkGeographicGlyph(map, at, renderer, (point, group) => {
        let image = group.querySelector('image');
        let eye = group.querySelector('circle');
        if (!image) {
            image = svgElement('image', { 'class': 'tn-geo-cyclone-spin', 'href': '/network-icons/cyclone-blue.png',
                'width': String(NETWORK_CYCLONE_SIZE_PX), 'height': String(NETWORK_CYCLONE_SIZE_PX),
                'preserveAspectRatio': 'xMidYMid meet', 'pointer-events': 'none' });
            group.appendChild(image);
        }
        if (!eye) {
            eye = svgElement('circle', { 'class': 'tn-geo-cyclone-eye', 'r': '3.5', 'stroke': 'none',
                'pointer-events': 'none' });
            group.appendChild(eye);
        }
        image.setAttribute('x', String(point.x - NETWORK_CYCLONE_SIZE_PX / 2));
        image.setAttribute('y', String(point.y - NETWORK_CYCLONE_SIZE_PX / 2));
        eye.setAttribute('cx', String(point.x));
        eye.setAttribute('cy', String(point.y));
    }, { interactive: true, radius: NETWORK_CYCLONE_SIZE_PX / 2 });
}

window.__networkSvgTest={networkGeographicGlyph,geographicLead,geographicCyclone};
