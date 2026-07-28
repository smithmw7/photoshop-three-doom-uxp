// Ported from: linuxdoom-1.10/wi_stuff.c — intermission ("between missions")
// screen. Faithful port of the single-player path: animated background, the
// "<Level> Finished!" tally with the count-up state machine, and the Doom 1
// world map ("Entering …" with splats on visited levels + the flashing
// "You Are Here" pointer).
//
// Rendering uses the Canvas2D overlay (v_video.js V_DecodePatchToCanvas /
// V_DrawPatchAtCanvas) instead of the software framebuffer, but every patch,
// coordinate and timing value is taken verbatim from wi_stuff.c so the screen
// matches vanilla pixel-for-pixel. WI_Drawer receives (ctx, dx, dy, dw, dh):
// the on-canvas rectangle the 320x200 virtual screen maps to; we scale virtual
// coords by sx=dw/320, sy=dh/200.
//
// Deathmatch / netgame stat tables (WI_drawDeathmatchStats /
// WI_drawNetgameStats) are intentionally omitted — they are unreachable in this
// single-player port.

import { gamemode } from './doomstat.js';
import { GameMode_t, TICRATE, SCREENWIDTH, SCREENHEIGHT } from './doomdef.js';
import { S_StartSound, S_ChangeMusic } from './s_sound.js';
import { M_Random } from './m_random.js';
import { mus_inter, mus_dm2int, sfx_pistol, sfx_barexp, sfx_sgcock } from './sounds.js';
import { V_DecodePatchToCanvas, V_DrawPatchAtCanvas } from './v_video.js';

// ----------------------------------------------------------------------------
// Par-time tables (g_game.c:978/987). Vanilla stores these in g_game and bakes
// wminfo.partime = TICRATE*pars[...]; this port's G_DoCompleted doesn't, so WI
// computes partime (in tics) from these at WI_Start.
// ----------------------------------------------------------------------------

// Doom 1 par times [episode][map]; episode-0 row unused, episodes 1..3 fill
// maps 1..9. Episode 4 (Ultimate Doom) has no canonical par times.
const pars = [
  [0],
  [0, 30, 75, 120, 90, 165, 180, 180, 30, 165],
  [0, 90, 90,  90, 120, 90, 360, 240, 30, 170],
  [0, 90, 45,  90, 150, 90,  90, 165, 30, 135],
];

// Doom 2 par times [map-1], maps 1..32.
const cpars = [
   30, 90,120,120, 90,150,120,120,270, 90,  //  1-10
  210,150,150,150,210,150,420,150,210,150,  // 11-20
  240,150,180,150,150,300,330,420,300,180,  // 21-30
  120, 30,                                  // 31-32
];

// Par time (in TICS) for the just-finished map, indexed by 0-based epsd/last
// like wbstartstruct. Returns 0 when there is no canonical par (E4 / OOB).
function _parTimeTics(epsd0, last0) {
  if (gamemode === GameMode_t.commercial) {
    return (last0 >= 0 && last0 < 32) ? TICRATE * cpars[last0] : 0;
  }
  const ep = epsd0 + 1, mp = last0 + 1;
  if (ep >= 1 && ep <= 3 && mp >= 1 && mp <= 9) return TICRATE * pars[ep][mp];
  return 0;
}

// ----------------------------------------------------------------------------
// Constants (wi_stuff.c / wi_stuff.h)
// ----------------------------------------------------------------------------

const NUMMAPS = 9;

// GLOBAL LOCATIONS
const WI_TITLEY = 2;

// SINGLE-PLAYER STUFF
const SP_STATSX = 50;
const SP_STATSY = 50;
const SP_TIMEX  = 16;
const SP_TIMEY  = SCREENHEIGHT - 32;

// in seconds
const SHOWNEXTLOCDELAY = 4;

// stateenum_t
const NoState     = -1;
const StatCount   = 0;
const ShowNextLoc = 1;

// animenum_t
const ANIM_ALWAYS = 0;
const ANIM_RANDOM = 1;
const ANIM_LEVEL  = 2;

// ----------------------------------------------------------------------------
// "You Are Here" level dot coordinates lnodes[episode][map] (wi_stuff.c:177)
// ----------------------------------------------------------------------------
const lnodes = [
  // Episode 0 World Map
  [ [185,164],[148,143],[69,122],[209,102],[116,89],[166,55],[71,56],[135,29],[71,24] ],
  // Episode 1 World Map
  [ [254,25],[97,50],[188,64],[128,78],[214,92],[133,130],[208,136],[148,140],[235,158] ],
  // Episode 2 World Map
  [ [156,168],[48,154],[174,95],[265,75],[130,48],[279,23],[198,48],[140,25],[281,136] ],
];

// ----------------------------------------------------------------------------
// Animation tables (wi_stuff.c:226). One mutable anim_t per entry; runtime
// fields (p[], nexttic, ctr, state) are reset by WI_initAnimatedBack and the
// frame graphics filled by WI_loadData — both run once per intermission, never
// per frame, so no allocation happens in the tick/draw loop.
// ----------------------------------------------------------------------------
const P3 = (TICRATE / 3) | 0; // 11
const P4 = (TICRATE / 4) | 0; // 8

function mkanim(type, period, nanims, x, y, data1, data2) {
  return {
    type, period, nanims, loc: { x, y },
    data1: data1 | 0, data2: data2 | 0,
    p: [null, null, null],
    nexttic: 0, ctr: -1,
  };
}

const epsd0animinfo = [
  mkanim(ANIM_ALWAYS, P3, 3, 224, 104),
  mkanim(ANIM_ALWAYS, P3, 3, 184, 160),
  mkanim(ANIM_ALWAYS, P3, 3, 112, 136),
  mkanim(ANIM_ALWAYS, P3, 3,  72, 112),
  mkanim(ANIM_ALWAYS, P3, 3,  88,  96),
  mkanim(ANIM_ALWAYS, P3, 3,  64,  48),
  mkanim(ANIM_ALWAYS, P3, 3, 192,  40),
  mkanim(ANIM_ALWAYS, P3, 3, 136,  16),
  mkanim(ANIM_ALWAYS, P3, 3,  80,  16),
  mkanim(ANIM_ALWAYS, P3, 3,  64,  24),
];

const epsd1animinfo = [
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 1),
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 2),
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 3),
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 4),
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 5),
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 6),
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 7),
  mkanim(ANIM_LEVEL, P3, 3, 192, 144, 8),
  mkanim(ANIM_LEVEL, P3, 1, 128, 136, 8),
];

const epsd2animinfo = [
  mkanim(ANIM_ALWAYS, P3, 3, 104, 168),
  mkanim(ANIM_ALWAYS, P3, 3,  40, 136),
  mkanim(ANIM_ALWAYS, P3, 3, 160,  96),
  mkanim(ANIM_ALWAYS, P3, 3, 104,  80),
  mkanim(ANIM_ALWAYS, P3, 3, 120,  32),
  mkanim(ANIM_ALWAYS, P4, 3,  40,   0),
];

const anims    = [epsd0animinfo, epsd1animinfo, epsd2animinfo];
const NUMANIMS = [epsd0animinfo.length, epsd1animinfo.length, epsd2animinfo.length];

// ----------------------------------------------------------------------------
// General data (wi_stuff.c "GENERAL DATA")
// ----------------------------------------------------------------------------

let acceleratestage = 0;   // accelerate/skip a stage
let me = 0;                // wbs.pnum
let state = StatCount;     // current state
let wbs = null;            // wbstartstruct passed into intermission
let plrs = null;           // wbs.plyr[]
let cnt = 0;               // general timing
let bcnt = 0;              // background-animation timing
let cnt_kills = 0, cnt_items = 0, cnt_secret = 0; // single-player [0] slots
let cnt_time = 0, cnt_par = 0, cnt_pause = 0;
let sp_state = 0;
let snl_pointeron = false;

let _active = false;       // gates ticker/drawer/responder when not running
let _onDone = null;        // called at end of NoState (vanilla G_WorldDone)

// ----------------------------------------------------------------------------
// Graphics (decoded patch infos: { canvas, w, h, leftoffset, topoffset } | null)
// ----------------------------------------------------------------------------
let bg        = null;        // background (map of levels)
const yah     = [null, null]; // "You Are Here" (+ alt)
let splat     = null;        // visited-level splat
let percent   = null, colon = null, wiminus = null;
const num     = new Array(10).fill(null); // 0-9
let finished  = null, entering = null, sp_secret = null;
let kills     = null, items = null;
let time      = null, par = null, sucks = null;
let lnames    = [];          // level-name patches (centered)
const _splatArr = [null];    // [splat] wrapper for WI_drawOnLnode; filled by WI_loadData

// ----------------------------------------------------------------------------
// Per-frame draw context (set by WI_Drawer). Virtual 320x200 -> device pixels.
// ----------------------------------------------------------------------------
let _ctx = null, _ox = 0, _oy = 0, _sx = 1, _sy = 1;

// Draw a decoded patch at virtual (vx, vy). V_DrawPatchAtCanvas applies the
// patch's leftoffset/topoffset (scaled) exactly like vanilla V_DrawPatch, so
// passing virtual coords reproduces vanilla placement under scaling.
function drawPatch(info, vx, vy) {
  if (info == null) return; // null or undefined (e.g. out-of-range lnames[])
  V_DrawPatchAtCanvas(_ctx, info, _ox + vx * _sx, _oy + vy * _sy, _sx, _sy);
}

// ----------------------------------------------------------------------------
// CODE
// ----------------------------------------------------------------------------

// wi_stuff.c:406 — vanilla memcpy's the prepared background screen over the
// framebuffer. Here we fill the letterbox black then blit the full-screen
// background patch.
function WI_slamBackground() {
  _ctx.fillStyle = '#000';
  _ctx.fillRect(_ox, _oy, SCREENWIDTH * _sx, SCREENHEIGHT * _sy);
  drawPatch(bg, 0, 0);
}

// Draws "<Levelname> Finished!" (wi_stuff.c:421)
function WI_drawLF() {
  let y = WI_TITLEY;
  const ln = lnames[wbs.last];
  // draw <LevelName>
  if (ln !== null && ln !== undefined) {
    drawPatch(ln, ((SCREENWIDTH - ln.w) / 2) | 0, y);
    // draw "Finished!"
    y += ((5 * ln.h) / 4) | 0;
  }
  if (finished !== null) drawPatch(finished, ((SCREENWIDTH - finished.w) / 2) | 0, y);
}

// Draws "Entering <LevelName>" (wi_stuff.c:439)
function WI_drawEL() {
  let y = WI_TITLEY;
  const ln = lnames[wbs.next];
  // draw "Entering"
  if (entering !== null) drawPatch(entering, ((SCREENWIDTH - entering.w) / 2) | 0, y);
  // draw level
  if (ln !== null && ln !== undefined) {
    y += ((5 * ln.h) / 4) | 0;
    drawPatch(ln, ((SCREENWIDTH - ln.w) / 2) | 0, y);
  }
}

// Draws patch c[i] (first variant that fits on screen) at lnodes[epsd][n]
// (wi_stuff.c:455). c is an array of 1 or 2 patch infos.
function WI_drawOnLnode(n, c) {
  if (wbs.epsd < 0 || wbs.epsd > 2 || n < 0 || n >= NUMMAPS) return;
  const node = lnodes[wbs.epsd][n];
  let i = 0;
  let fits = false;
  do {
    const ci = c[i];
    if (ci === null || ci === undefined) { i++; continue; }
    const left   = node[0] - ci.leftoffset;
    const top    = node[1] - ci.topoffset;
    const right  = left + ci.w;
    const bottom = top + ci.h;
    if (left >= 0 && right < SCREENWIDTH && top >= 0 && bottom < SCREENHEIGHT) fits = true;
    else i++;
  } while (fits === false && i !== 2);

  if (fits === true && i < 2) {
    drawPatch(c[i], node[0], node[1]);
  } else {
    console.log(`WI: Could not place patch on level ${n + 1}`);
  }
}

// --- Animated background (wi_stuff.c:503) ---

function WI_initAnimatedBack() {
  if (gamemode === GameMode_t.commercial) return;
  if (wbs.epsd > 2) return;

  for (let i = 0; i < NUMANIMS[wbs.epsd]; i++) {
    const a = anims[wbs.epsd][i];
    a.ctr = -1; // init
    // specify the next time to draw it
    if (a.type === ANIM_ALWAYS)
      a.nexttic = bcnt + 1 + (M_Random() % a.period);
    else if (a.type === ANIM_RANDOM)
      a.nexttic = bcnt + 1 + a.data2 + (M_Random() % a.data1);
    else if (a.type === ANIM_LEVEL)
      a.nexttic = bcnt + 1;
  }
}

function WI_updateAnimatedBack() {
  if (gamemode === GameMode_t.commercial) return;
  if (wbs.epsd > 2) return;

  for (let i = 0; i < NUMANIMS[wbs.epsd]; i++) {
    const a = anims[wbs.epsd][i];
    if (bcnt === a.nexttic) {
      switch (a.type) {
        case ANIM_ALWAYS:
          if (++a.ctr >= a.nanims) a.ctr = 0;
          a.nexttic = bcnt + a.period;
          break;
        case ANIM_RANDOM:
          a.ctr++;
          if (a.ctr === a.nanims) {
            a.ctr = -1;
            a.nexttic = bcnt + a.data2 + (M_Random() % a.data1);
          } else a.nexttic = bcnt + a.period;
          break;
        case ANIM_LEVEL:
          // gawd-awful hack for level anims
          if (!(state === StatCount && i === 7) && wbs.next === a.data1) {
            a.ctr++;
            if (a.ctr === a.nanims) a.ctr--;
            a.nexttic = bcnt + a.period;
          }
          break;
      }
    }
  }
}

function WI_drawAnimatedBack() {
  if (gamemode === GameMode_t.commercial) return;
  if (wbs.epsd > 2) return;

  for (let i = 0; i < NUMANIMS[wbs.epsd]; i++) {
    const a = anims[wbs.epsd][i];
    if (a.ctr >= 0) drawPatch(a.p[a.ctr], a.loc.x, a.loc.y);
  }
}

// Draws a number. If digits > 0, use that many minimum; if < 0, only as many as
// necessary. Returns new x. (wi_stuff.c:611)
function WI_drawNum(x, y, n, digits) {
  const fontwidth = (num[0] !== null) ? num[0].w : 0;
  let temp;

  if (digits < 0) {
    if (n === 0) {
      digits = 1; // variable-length zero is 1 digit
    } else {
      digits = 0;
      temp = n;
      while (temp !== 0) { temp = (temp / 10) | 0; digits++; }
    }
  }

  const neg = n < 0;
  if (neg === true) n = -n;

  // if non-number, do not draw it
  if (n === 1994) return 0;

  // draw the new number
  while (digits-- > 0) {
    x -= fontwidth;
    drawPatch(num[n % 10], x, y);
    n = (n / 10) | 0;
  }

  // draw a minus sign if necessary
  if (neg === true) { x -= 8; drawPatch(wiminus, x, y); }

  return x;
}

function WI_drawPercent(x, y, p) {
  if (p < 0) return;
  drawPatch(percent, x, y);
  WI_drawNum(x, y, p, -1);
}

// Display level completion time and par, or "sucks" on overflow (wi_stuff.c:687)
function WI_drawTime(x, y, t) {
  if (t < 0) return;

  if (t <= 61 * 59) {
    let div = 1;
    const colw = (colon !== null) ? colon.w : 0;
    do {
      const n = ((t / div) | 0) % 60;
      x = WI_drawNum(x, y, n, 2) - colw;
      div *= 60;
      // draw colon
      if (div === 60 || ((t / div) | 0) !== 0) drawPatch(colon, x, y);
    } while (((t / div) | 0) !== 0);
  } else {
    // "sucks"
    if (sucks !== null) drawPatch(sucks, x - sucks.w, y);
  }
}

function WI_End() {
  _active = false;
  WI_unloadData();
}

function WI_initNoState() {
  state = NoState;
  acceleratestage = 0;
  cnt = 10;
}

function WI_updateNoState() {
  WI_updateAnimatedBack();
  cnt--;
  if (cnt === 0) {
    WI_End();
    _onDone(); // vanilla: G_WorldDone()
  }
}

function WI_initShowNextLoc() {
  state = ShowNextLoc;
  acceleratestage = 0;
  cnt = SHOWNEXTLOCDELAY * TICRATE;
  WI_initAnimatedBack();
}

function WI_updateShowNextLoc() {
  WI_updateAnimatedBack();
  cnt--;
  if (cnt === 0 || acceleratestage === 1) WI_initNoState();
  else snl_pointeron = (cnt & 31) < 20;
}

function WI_drawShowNextLoc() {
  WI_slamBackground();
  WI_drawAnimatedBack();

  if (gamemode !== GameMode_t.commercial) {
    if (wbs.epsd > 2) { WI_drawEL(); return; }

    const last = (wbs.last === 8) ? wbs.next - 1 : wbs.last;

    // draw a splat on taken cities
    for (let i = 0; i <= last; i++) WI_drawOnLnode(i, _splatArr);

    // splat the secret level?
    if (wbs.didsecret === true) WI_drawOnLnode(8, _splatArr);

    // draw flashing ptr
    if (snl_pointeron === true) WI_drawOnLnode(wbs.next, yah);
  }

  // draws which level you are entering
  if (gamemode !== GameMode_t.commercial || wbs.next !== 30) WI_drawEL();
}

function WI_drawNoState() {
  snl_pointeron = true;
  WI_drawShowNextLoc();
}

// --- Single-player stats (wi_stuff.c:1316) ---

function _pctTarget(count, max) {
  // (count * 100) / max, integer-truncated like C. max is >=1 (WI_initVariables).
  return ((count * 100) / max) | 0;
}

function WI_initStats() {
  state = StatCount;
  acceleratestage = 0;
  sp_state = 1;
  cnt_kills = cnt_items = cnt_secret = -1;
  cnt_time = cnt_par = -1;
  cnt_pause = TICRATE;
  WI_initAnimatedBack();
}

function WI_updateStats() {
  WI_updateAnimatedBack();

  if (acceleratestage === 1 && sp_state !== 10) {
    acceleratestage = 0;
    cnt_kills  = _pctTarget(plrs[me].skills,  wbs.maxkills);
    cnt_items  = _pctTarget(plrs[me].sitems,  wbs.maxitems);
    cnt_secret = _pctTarget(plrs[me].ssecret, wbs.maxsecret);
    cnt_time   = (plrs[me].stime / TICRATE) | 0;
    cnt_par    = (wbs.partime / TICRATE) | 0;
    S_StartSound(null, sfx_barexp);
    sp_state = 10;
  }

  if (sp_state === 2) {
    cnt_kills += 2;
    if ((bcnt & 3) === 0) S_StartSound(null, sfx_pistol);
    const t = _pctTarget(plrs[me].skills, wbs.maxkills);
    if (cnt_kills >= t) { cnt_kills = t; S_StartSound(null, sfx_barexp); sp_state++; }
  } else if (sp_state === 4) {
    cnt_items += 2;
    if ((bcnt & 3) === 0) S_StartSound(null, sfx_pistol);
    const t = _pctTarget(plrs[me].sitems, wbs.maxitems);
    if (cnt_items >= t) { cnt_items = t; S_StartSound(null, sfx_barexp); sp_state++; }
  } else if (sp_state === 6) {
    cnt_secret += 2;
    if ((bcnt & 3) === 0) S_StartSound(null, sfx_pistol);
    const t = _pctTarget(plrs[me].ssecret, wbs.maxsecret);
    if (cnt_secret >= t) { cnt_secret = t; S_StartSound(null, sfx_barexp); sp_state++; }
  } else if (sp_state === 8) {
    if ((bcnt & 3) === 0) S_StartSound(null, sfx_pistol);
    const tTime = (plrs[me].stime / TICRATE) | 0;
    const tPar  = (wbs.partime / TICRATE) | 0;
    cnt_time += 3;
    if (cnt_time >= tTime) cnt_time = tTime;
    cnt_par += 3;
    if (cnt_par >= tPar) {
      cnt_par = tPar;
      if (cnt_time >= tTime) { S_StartSound(null, sfx_barexp); sp_state++; }
    }
  } else if (sp_state === 10) {
    if (acceleratestage === 1) {
      S_StartSound(null, sfx_sgcock);
      if (gamemode === GameMode_t.commercial) WI_initNoState();
      else WI_initShowNextLoc();
    }
  } else if ((sp_state & 1) === 1) {
    cnt_pause--;
    if (cnt_pause === 0) { sp_state++; cnt_pause = TICRATE; }
  }
}

function WI_drawStats() {
  // line height
  const lh = (num[0] !== null) ? ((3 * num[0].h) / 2) | 0 : 0;

  WI_slamBackground();
  WI_drawAnimatedBack();
  WI_drawLF();

  drawPatch(kills, SP_STATSX, SP_STATSY);
  WI_drawPercent(SCREENWIDTH - SP_STATSX, SP_STATSY, cnt_kills);

  drawPatch(items, SP_STATSX, SP_STATSY + lh);
  WI_drawPercent(SCREENWIDTH - SP_STATSX, SP_STATSY + lh, cnt_items);

  drawPatch(sp_secret, SP_STATSX, SP_STATSY + 2 * lh);
  WI_drawPercent(SCREENWIDTH - SP_STATSX, SP_STATSY + 2 * lh, cnt_secret);

  drawPatch(time, SP_TIMEX, SP_TIMEY);
  WI_drawTime((SCREENWIDTH / 2) - SP_TIMEX, SP_TIMEY, cnt_time);

  if (wbs.epsd < 3) {
    drawPatch(par, (SCREENWIDTH / 2) + SP_TIMEX, SP_TIMEY);
    WI_drawTime(SCREENWIDTH - SP_TIMEX, SP_TIMEY, cnt_par);
  }
}

// ----------------------------------------------------------------------------
// Ticker / responder / drawer / start
// ----------------------------------------------------------------------------

// wi_stuff.c:412 — vanilla WI_Responder is a stub; acceleration is polled from
// ticcmd buttons in WI_checkForAccelerate. This port is event-driven during
// intermission (no ticcmd is built), so a keypress sets acceleratestage here.
// Auto-repeat is filtered upstream (d_keyboard) so each physical press counts
// once — equivalent to vanilla's rising-edge attack/use debounce.
export function WI_Responder(ev) {
  if (_active !== true) return false;
  if (ev !== null && ev !== undefined && ev.type === 0) {
    acceleratestage = 1;
    return true;
  }
  return false;
}

// Updates stuff each tick (wi_stuff.c:1502). Single-player path only.
export function WI_Ticker() {
  if (_active !== true) return;

  // counter for general background animation
  bcnt++;

  if (bcnt === 1) {
    // intermission music
    if (gamemode === GameMode_t.commercial) S_ChangeMusic(mus_dm2int, true);
    else S_ChangeMusic(mus_inter, true);
  }

  // acceleratestage is supplied by WI_Responder (see note above).

  switch (state) {
    case StatCount:   WI_updateStats();       break;
    case ShowNextLoc: WI_updateShowNextLoc(); break;
    case NoState:     WI_updateNoState();      break;
  }
}

function WI_loadData() {
  // background
  let name;
  if (gamemode === GameMode_t.commercial) name = 'INTERPIC';
  else name = 'WIMAP' + wbs.epsd;
  if (gamemode === GameMode_t.retail && wbs.epsd === 3) name = 'INTERPIC';
  bg = V_DecodePatchToCanvas(name);

  if (gamemode === GameMode_t.commercial) {
    lnames = new Array(32);
    for (let i = 0; i < 32; i++) lnames[i] = V_DecodePatchToCanvas('CWILV' + String(i).padStart(2, '0'));
  } else {
    lnames = new Array(NUMMAPS);
    for (let i = 0; i < NUMMAPS; i++) lnames[i] = V_DecodePatchToCanvas('WILV' + wbs.epsd + i);

    // you are here (+ alt)
    yah[0] = V_DecodePatchToCanvas('WIURH0');
    yah[1] = V_DecodePatchToCanvas('WIURH1');

    // splat
    splat = V_DecodePatchToCanvas('WISPLAT');
    _splatArr[0] = splat;

    if (wbs.epsd < 3) {
      for (let j = 0; j < NUMANIMS[wbs.epsd]; j++) {
        const a = anims[wbs.epsd][j];
        for (let i = 0; i < a.nanims; i++) {
          // MONDO HACK! Episode 1 anim 8 reuses anim 4's frames.
          if (wbs.epsd !== 1 || j !== 8) {
            a.p[i] = V_DecodePatchToCanvas('WIA' + wbs.epsd + String(j).padStart(2, '0') + String(i).padStart(2, '0'));
          } else {
            a.p[i] = anims[1][4].p[i];
          }
        }
      }
    }
  }

  // minus sign
  wiminus = V_DecodePatchToCanvas('WIMINUS');
  // numbers 0-9
  for (let i = 0; i < 10; i++) num[i] = V_DecodePatchToCanvas('WINUM' + i);
  // percent sign
  percent = V_DecodePatchToCanvas('WIPCNT');
  // "finished" / "entering"
  finished = V_DecodePatchToCanvas('WIF');
  entering = V_DecodePatchToCanvas('WIENTER');
  // "kills"
  kills = V_DecodePatchToCanvas('WIOSTK');
  // "secret" (single-player label)
  sp_secret = V_DecodePatchToCanvas('WISCRT2');
  // "items"
  items = V_DecodePatchToCanvas('WIOSTI');
  // ":"
  colon = V_DecodePatchToCanvas('WICOLON');
  // "time"
  time = V_DecodePatchToCanvas('WITIME');
  // "sucks"
  sucks = V_DecodePatchToCanvas('WISUCKS');
  // "par"
  par = V_DecodePatchToCanvas('WIPAR');
}

// Decoded patches live in v_video's persistent cache; nothing to free here (JS
// GC replaces the zone allocator). Drop our references so a later intermission
// re-resolves cleanly.
function WI_unloadData() {
  // intentionally empty — see note above.
}

export function WI_Drawer(ctx, dx, dy, dw, dh) {
  if (_active !== true) return;
  _ctx = ctx; _ox = dx; _oy = dy; _sx = dw / 320; _sy = dh / 200;

  switch (state) {
    case StatCount:   WI_drawStats();       break;
    case ShowNextLoc: WI_drawShowNextLoc(); break;
    case NoState:     WI_drawNoState();      break;
  }
}

function WI_initVariables(wbstartstruct) {
  wbs = wbstartstruct;

  acceleratestage = 0;
  cnt = bcnt = 0;
  me = wbs.pnum;
  plrs = wbs.plyr;

  if (wbs.maxkills  <= 0) wbs.maxkills  = 1;
  if (wbs.maxitems  <= 0) wbs.maxitems  = 1;
  if (wbs.maxsecret <= 0) wbs.maxsecret = 1;

  if (gamemode !== GameMode_t.retail) { if (wbs.epsd > 2) wbs.epsd -= 3; }

  // Vanilla bakes wminfo.partime in G_DoCompleted; this port doesn't, so derive
  // it (in tics) here from the par tables.
  if (wbs.partime === undefined || wbs.partime === null)
    wbs.partime = _parTimeTics(wbs.epsd, wbs.last);
}

export function WI_Start(wbstartstruct, onDone) {
  _onDone = (onDone !== null && onDone !== undefined) ? onDone : (() => {});
  WI_initVariables(wbstartstruct);
  WI_loadData();
  WI_initStats(); // single-player
  _active = true;
}

