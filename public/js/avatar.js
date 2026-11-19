/* MAKI avatar - a small, dependency-free SVG avatar system.
   An avatar is a plain object of option keys, e.g. { skin: 's3', hair: 'curly', ... }.
   Only known keys/values are ever rendered, so the stored object can't inject markup. */
(function (global) {
  var OPTIONS = {
    skin: { s1: '#fde3cf', s2: '#f6c9a3', s3: '#e3a77a', s4: '#c68558', s5: '#9b5f3a', s6: '#6b3f24' },
    hair: ['short', 'buzz', 'curly', 'long', 'bun', 'ponytail', 'spiky', 'bob', 'none'],
    hairColor: { h1: '#1d1a1a', h2: '#4a2c1d', h3: '#8a5a2b', h4: '#d9a441', h5: '#c0442c', h6: '#9aa3ad', h7: '#4f6df5', h8: '#e264a6' },
    eyes: ['dot', 'happy', 'wink', 'sleepy', 'star'],
    brows: ['soft', 'raised', 'focused', 'none'],
    mouth: ['smile', 'grin', 'open', 'smirk', 'tongue'],
    facial: ['none', 'stubble', 'mustache', 'beard'],
    hat: ['none', 'cap', 'visor', 'headband', 'beanie'],
    glasses: ['none', 'round', 'square', 'shades'],
    shirt: { t1: '#0a325e', t2: '#0b4fa8', t3: '#33d9ff', t4: '#f9e20b', t5: '#ff6b5b', t6: '#22c38e', t7: '#8b5cf6', t8: '#f4f6fa' },
    bg: { b1: '#dff4ff', b2: '#fff6c2', b3: '#e6e9ff', b4: '#ffe3de', b5: '#dcf7ec', b6: '#0a325e', b7: '#f1f5fb', b8: '#ffe9f4' },
  };
  var LABELS = {
    skin: 'Skin tone', hair: 'Hairstyle', hairColor: 'Hair color', eyes: 'Eyes', brows: 'Eyebrows', mouth: 'Mouth',
    facial: 'Facial hair', hat: 'Headwear', glasses: 'Eyewear', shirt: 'Jersey', bg: 'Background',
  };
  var DEFAULT = { skin: 's2', hair: 'short', hairColor: 'h2', eyes: 'dot', brows: 'soft', mouth: 'smile', facial: 'none', hat: 'visor', glasses: 'none', shirt: 't2', bg: 'b1' };

  function keysOf(k) { var o = OPTIONS[k]; return Array.isArray(o) ? o : Object.keys(o); }
  function clean(cfg) {
    var out = {};
    Object.keys(DEFAULT).forEach(function (k) {
      var v = cfg && cfg[k];
      out[k] = keysOf(k).indexOf(v) >= 0 ? v : DEFAULT[k];
    });
    return out;
  }
  function random() {
    var out = {};
    Object.keys(DEFAULT).forEach(function (k) { var ks = keysOf(k); out[k] = ks[Math.floor(Math.random() * ks.length)]; });
    if (Math.random() < 0.55) out.facial = 'none';
    if (Math.random() < 0.5) out.glasses = 'none';
    return out;
  }
  // darken/lighten a hex colour
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  var uid = 0;
  function svg(cfgIn, opts) {
    var c = clean(cfgIn); opts = opts || {};
    var id = 'av' + (++uid);
    var skin = OPTIONS.skin[c.skin], skinD = shade(skin, -28);
    var hc = OPTIONS.hairColor[c.hairColor], hcD = shade(hc, -25);
    var shirt = OPTIONS.shirt[c.shirt], shirtD = shade(shirt, -30);
    var bg = OPTIONS.bg[c.bg];
    var ink = '#1c2333';
    var p = [];

    p.push('<defs><clipPath id="' + id + 'c"><circle cx="60" cy="60" r="60"/></clipPath>' +
      '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + shade(bg, 14) + '"/><stop offset="1" stop-color="' + shade(bg, -16) + '"/></linearGradient></defs>');
    p.push('<g clip-path="url(#' + id + 'c)">');
    p.push('<rect width="120" height="120" fill="url(#' + id + 'g)"/>');
    // court lines in the background - a subtle brand touch
    p.push('<path d="M0 92H120M60 92V120" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none"/>');

    // hair that sits behind the head
    if (c.hair === 'long' && c.hat !== 'beanie') p.push('<path d="M33 54C29 30 43 19 60 19S91 30 87 54L90 92C82 97 73 95 70 90V62H50V90C47 95 38 97 30 92Z" fill="' + hc + '"/>');
    if (c.hair === 'ponytail') p.push('<path d="M80 40C96 42 100 62 92 80C90 70 86 62 79 58Z" fill="' + hcD + '"/>');
    if (c.hair === 'bob' && c.hat !== 'beanie') p.push('<path d="M32 56C28 30 44 20 60 20S92 30 88 56L88 74C82 78 76 76 74 72V58H46V72C44 76 38 78 32 74Z" fill="' + hc + '"/>');

    // body + neck
    p.push('<path d="M18 124C20 98 38 86 60 86S100 98 102 124Z" fill="' + shirt + '"/>');
    p.push('<path d="M47 87L60 101L73 87" fill="none" stroke="' + shirtD + '" stroke-width="3" stroke-linejoin="round"/>');
    p.push('<path d="M38 100C40 106 41 114 41 124M82 100C80 106 79 114 79 124" stroke="' + shirtD + '" stroke-opacity=".35" stroke-width="2" fill="none"/>');
    p.push('<path d="M51 72H69V88C66 93 54 93 51 88Z" fill="' + skinD + '"/>');

    // head
    p.push('<circle cx="36.5" cy="56" r="5.5" fill="' + skinD + '"/><circle cx="83.5" cy="56" r="5.5" fill="' + skinD + '"/>');
    p.push('<ellipse cx="60" cy="53" rx="24" ry="26" fill="' + skin + '"/>');
    p.push('<circle cx="47" cy="63" r="4" fill="#ff7a7a" fill-opacity=".22"/><circle cx="73" cy="63" r="4" fill="#ff7a7a" fill-opacity=".22"/>');

    // facial hair (under mouth)
    if (c.facial === 'stubble') p.push('<path d="M40 60C42 74 50 80 60 80S78 74 80 60C76 70 70 72 60 72S44 70 40 60Z" fill="' + hc + '" fill-opacity=".28"/>');
    if (c.facial === 'beard') p.push('<path d="M37 56C37 74 47 85 60 85S83 74 83 56C80 66 74 70 68 70C64 67 56 67 52 70C46 70 40 66 37 56Z" fill="' + hc + '"/>');

    // eyes
    var eyes = {
      dot: '<circle cx="51" cy="54" r="3"/><circle cx="69" cy="54" r="3"/><circle cx="52" cy="53" r="1" fill="#fff"/><circle cx="70" cy="53" r="1" fill="#fff"/>',
      happy: '<path d="M47 55Q51 50 55 55M65 55Q69 50 73 55" fill="none" stroke="' + ink + '" stroke-width="2.6" stroke-linecap="round"/>',
      wink: '<circle cx="51" cy="54" r="3"/><circle cx="52" cy="53" r="1" fill="#fff"/><path d="M65 55Q69 51 73 55" fill="none" stroke="' + ink + '" stroke-width="2.6" stroke-linecap="round"/>',
      sleepy: '<path d="M47 54Q51 57 55 54M65 54Q69 57 73 54" fill="none" stroke="' + ink + '" stroke-width="2.6" stroke-linecap="round"/>',
      star: '<path d="M51 49.5l1.3 3 3.2.3-2.4 2.1.7 3.2-2.8-1.7-2.8 1.7.7-3.2-2.4-2.1 3.2-.3zM69 49.5l1.3 3 3.2.3-2.4 2.1.7 3.2-2.8-1.7-2.8 1.7.7-3.2-2.4-2.1 3.2-.3z" fill="#f9b90b" stroke="' + ink + '" stroke-width=".8"/>',
    };
    p.push('<g fill="' + ink + '">' + eyes[c.eyes] + '</g>');

    var brows = {
      soft: '<path d="M46 46Q51 43.5 56 46M64 46Q69 43.5 74 46"/>',
      raised: '<path d="M46 44Q51 40 56 43M64 43Q69 40 74 44"/>',
      focused: '<path d="M46 44L56 46.5M64 46.5L74 44"/>',
      none: '',
    };
    if (brows[c.brows]) p.push('<g fill="none" stroke="' + hcD + '" stroke-width="2.4" stroke-linecap="round">' + brows[c.brows] + '</g>');

    // mouth
    var mouth = {
      smile: '<path d="M53 65Q60 71 67 65" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>',
      grin: '<path d="M51 64H69Q67 73 60 73T51 64Z" fill="' + ink + '"/><path d="M53 64.5H67V66.5H53Z" fill="#fff"/>',
      open: '<ellipse cx="60" cy="67" rx="4.5" ry="5" fill="' + ink + '"/><ellipse cx="60" cy="69.5" rx="3" ry="2" fill="#ff8a8a"/>',
      smirk: '<path d="M54 67Q61 69 67 64" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>',
      tongue: '<path d="M52 65Q60 72 68 65" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/><path d="M57 68.5Q57 74 60.5 74T64 68" fill="#ff7a8a"/>',
    };
    p.push(mouth[c.mouth]);
    if (c.facial === 'mustache') p.push('<path d="M50 63Q55 58 60 61Q65 58 70 63Q65 62 60 64Q55 62 50 63Z" fill="' + hc + '"/>');
    if (c.facial === 'beard') p.push('<path d="M51 63Q56 59 60 61Q64 59 69 63Q64 62.5 60 64Q56 62.5 51 63Z" fill="' + hcD + '"/>');

    // front hair
    var hatOn = c.hat === 'cap' || c.hat === 'beanie';
    var front = {
      short: '<path d="M35 50C33 29 46 21 60 21C76 21 88 30 85 50C81 41 72 35 61 35C50 35 40 41 35 50Z" fill="' + hc + '"/>',
      buzz: '<path d="M36.5 47C37 30 48 25 60 25C73 25 83 31 83.5 47C79 38 70 33 60 33C50 33 41 38 36.5 47Z" fill="' + hc + '" fill-opacity=".75"/>',
      curly: '<g fill="' + hc + '"><circle cx="40" cy="42" r="7"/><circle cx="46" cy="32" r="8"/><circle cx="57" cy="26" r="8.5"/><circle cx="69" cy="27" r="8.5"/><circle cx="78" cy="34" r="8"/><circle cx="81" cy="44" r="6.5"/><circle cx="60" cy="35" r="8"/></g>',
      long: '<path d="M35 52C33 28 46 20 60 20C77 20 89 29 85 52C80 40 70 33 58 34C50 35 41 42 35 52Z" fill="' + hc + '"/>',
      bun: '<circle cx="60" cy="18" r="9" fill="' + hcD + '"/><path d="M35 50C33 29 46 22 60 22C76 22 88 30 85 50C81 41 72 35 61 35C50 35 40 41 35 50Z" fill="' + hc + '"/>',
      ponytail: '<path d="M35 50C33 29 46 21 60 21C76 21 88 30 85 50C82 40 72 33 59 34C48 35 40 42 35 50Z" fill="' + hc + '"/>',
      spiky: '<path d="M35 50L36 32L42 37L45 22L52 32L58 18L63 31L71 20L74 33L82 26L84 50C80 41 71 36 60 36C49 36 40 41 35 50Z" fill="' + hc + '"/>',
      bob: '<path d="M35 52C33 28 46 20 60 20C77 20 89 29 85 52C78 44 66 40 56 40C47 40 40 45 35 52Z" fill="' + hc + '"/>',
      none: '',
    };
    if (!hatOn || c.hair === 'long' || c.hair === 'bob') p.push(front[c.hair]);

    // headwear
    var ball = '#f9e20b';
    var hats = {
      none: '',
      cap: '<path d="M34 47C34 28 46 20 60 20S86 28 86 47Z" fill="' + shirt + '"/><path d="M34 47C34 28 46 20 60 20S86 28 86 47Z" fill="#000" fill-opacity=".08"/><path d="M60 21V46" stroke="' + shirtD + '" stroke-width="1.5"/><circle cx="60" cy="21" r="2.5" fill="' + shirtD + '"/><path d="M30 46H90Q91 52 84 52H30Q26 52 30 46Z" fill="' + shirtD + '"/>',
      visor: '<rect x="34" y="37" width="52" height="8" rx="4" fill="#fff"/><path d="M36 44H96Q99 50 90 51H40Z" fill="' + shirt + '"/><circle cx="46" cy="41" r="2.4" fill="' + ball + '"/>',
      headband: '<rect x="34.5" y="37" width="51" height="7" rx="3.5" fill="' + ball + '"/><path d="M36 40.5H84" stroke="#fff" stroke-width="1.4" stroke-dasharray="3 3"/>',
      beanie: '<path d="M34 48C33 26 46 17 60 17S87 26 86 48Z" fill="' + shirt + '"/><rect x="32" y="42" width="56" height="9" rx="4.5" fill="' + shirtD + '"/><circle cx="60" cy="15" r="5" fill="' + ball + '"/>',
    };
    p.push(hats[c.hat]);

    // eyewear
    var gl = {
      none: '',
      round: '<g fill="#fff" fill-opacity=".25" stroke="' + ink + '" stroke-width="2"><circle cx="51" cy="54" r="7"/><circle cx="69" cy="54" r="7"/></g><path d="M58 54H62M44 53L37 51M76 53L83 51" stroke="' + ink + '" stroke-width="2"/>',
      square: '<g fill="#fff" fill-opacity=".25" stroke="' + ink + '" stroke-width="2"><rect x="43" y="48.5" width="15" height="11" rx="3"/><rect x="62" y="48.5" width="15" height="11" rx="3"/></g><path d="M58 53H62M43 52L37 51M77 52L83 51" stroke="' + ink + '" stroke-width="2"/>',
      shades: '<path d="M42 49H58V55Q58 61 50 61T42 55ZM62 49H78V55Q78 61 70 61T62 55Z" fill="#111827"/><path d="M58 51H62M42 50L37 49M78 50L83 49" stroke="#111827" stroke-width="2"/><path d="M45 51L49 51M65 51L69 51" stroke="#fff" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round"/>',
    };
    p.push(gl[c.glasses]);
    p.push('</g>');

    var size = opts.size || 120;
    var title = opts.title ? '<title>' + String(opts.title).replace(/[<&>"]/g, '') + '</title>' : '';
    return '<svg class="avatar-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' + (opts.zoom ? '18 6 84 84' : '0 0 120 120') + '" width="' + size + '" height="' + size + '" role="img" aria-label="' +
      (opts.title ? String(opts.title).replace(/[<&>"]/g, '') : 'Avatar') + '">' + title + p.join('') + '</svg>';
  }

  // last-known avatar for instant paint before the profile request returns
  function cached() { try { return JSON.parse(localStorage.getItem('makiAvatar') || 'null'); } catch (e) { return null; } }
  function remember(cfg) { try { localStorage.setItem('makiAvatar', JSON.stringify(clean(cfg))); } catch (e) { /* storage off */ } }

  global.MakiAvatar = { OPTIONS: OPTIONS, LABELS: LABELS, DEFAULT: DEFAULT, keysOf: keysOf, clean: clean, random: random, svg: svg, cached: cached, remember: remember };
})(window);
