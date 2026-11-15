/* ============================================================================
   engine.js - Stochastic agent-based COVID-19 model (no DOM, no graphics).

   One step = one hour, played as 12 sub-steps of 5 minutes. In each sub-step people
   walk, stop at stalls, benches, tables and queues, talk, shout and cough, and the
   virus moves through the air (see the physics section below). All randomness comes
   from one seeded generator, so the same parameters and seed always replay the same
   outbreak.

   Health states:  Healthy -> Exposed -> Infectious -> (Severe) -> Recovered / Deceased
   What is decided at the moment of infection (the person's "fate"):
     - silent (never feels sick) or symptomatic
     - mild or severe, from age, comorbidity and vaccine protection
     - a personal frailty draw that decides survival once severe
     - how long each stage lasts for this person
   ========================================================================== */
const HEALTHY = 0, EXPOSED = 1, INFECTIOUS = 2, SEVERE = 3, RECOVERED = 4, DECEASED = 5;
const STATE_NAMES = ["Healthy", "Exposed", "Infectious", "Severe", "Recovered", "Deceased"];
const AGE_GROUPS = ["0-17", "18-39", "40-59", "60+"];
// Illustrative risk tables (assumptions, not fitted): chance an infection turns severe, and chance a severe case dies.
const P_SEVERE = [0.01, 0.03, 0.10, 0.30];
const P_DIE_IF_SEVERE = [0.05, 0.08, 0.15, 0.35];
const AGE_SHARE = { synthetic: [0.30, 0.36, 0.22, 0.12], ph: [0.36, 0.36, 0.195, 0.085], older: [0.14, 0.28, 0.30, 0.28] };
const AGE_RANGE = [[3, 17], [18, 39], [40, 59], [60, 89]];
const COMORBIDITY = [0.03, 0.08, 0.22, 0.45];
const PERSONAS = [["Cautious", 0.8, 0.8], ["Social", 1.3, 0.5], ["Routine", 1.0, 0.55], ["Sceptic", 1.1, 0.2]]; // name, mobility, compliance
const FIRST = [["Juan", "Jose", "Mark", "Paolo", "Miguel", "Carlo", "Ramon", "Andres", "Noel", "Jerome", "Rafael", "Dennis"],
               ["Maria", "Ana", "Grace", "Liza", "Carmen", "Joy", "Rosa", "Angel", "Kristine", "Bea", "Teresa", "Jasmine"]];
const LAST = ["Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Flores", "Ramos", "Aquino", "Castillo", "Villanueva", "Navarro", "Domingo"];
const JOBS = ["Nurse", "Teacher", "Market vendor", "Jeepney driver", "Office clerk", "Engineer", "Cashier", "Security guard", "Call-centre agent", "Cook", "Delivery rider", "Pharmacist"];

/* Locations. Coordinates are in "units" (about 0.6 m); ox/oz place each zone in the 3D world.
   pois are the places where people do things: stalls and food carts (with a vendor), benches, canteen tables,
   spots where groups stand and chat, and queues. Each has numbered slots, so nobody stands on someone else.
   entrances are spread round the edge, so arrivals and departures do not funnel through one point.
   phys.rooms are enclosed air spaces with a volume (m3) and air changes per hour; anywhere else is open air. */
const E0 = list => list.map(([x, z]) => ({ x, z, zone: 0 }));
const HOSP_STAFF = { doctors: 6, nurses: 14, other: 10 };   // fixed hospital staff (other = guard, cleaners, receptionist)
function bedRow(x0, x1, step, z, yaw, zone) { const o = []; for (let x = x0; x <= x1 + 1e-6; x += step) o.push({ x, z, yaw, zone }); return o; }
const ring = (cx, cz, r, n, kind, label) => Array.from({ length: n }, (_, k) => ({ kind, label, x: cx + r * Math.cos(k / n * 6.2832 + 0.5), z: cz + r * Math.sin(k / n * 6.2832 + 0.5), cx, cz }));
const spots = (list, label) => list.map(([x, z]) => ({ kind: "spot", x, z, label }));
const MARKET_GOODS = ["bangus", "tomatoes", "pork", "rice", "kangkong", "eggplant", "chicken", "dried fish", "tilapia", "calamansi", "mangoes", "shrimp", "longganisa"];
const ENVS = {
  cityhall: { name: "City hall plaza", type: "walk", risk: "Lower risk", pop: 900, days: 90, open: [6, 21], stay: 2.5, talk: 0.85, kf: 0.15, peaks: [7, 8, 12, 17, 18],
    speed: 1.0, freeMult: 1.0, freePop: 300, zones: [{ key: "plaza", name: "Plaza", W: 112, D: 50, ox: -56, oz: -36, obstacles: [[46.5, 12.5, 65.5, 31.5], [81.5, 26, 90.5, 30]] }], entrances: E0([[8, 49], [24, 49], [40, 49], [72, 49], [88, 49], [104, 49], [1, 30], [111, 30], [56, 1.5]]),
    pois: ring(56, 22, 12.5, 6, "bench", "by the fountain").concat(
      [{ kind: "stall", x: 86, z: 32.2, fz: 1, goods: "snacks", label: "the snack kiosk", vx: 86, vz: 24.6 }, { kind: "cart", x: 26, z: 27.6, fz: 1, goods: "kwek-kwek and fishballs", label: "the street-food cart", vx: 26, vz: 24.2, prop: "cart" },
       { kind: "queue", x: 56, z: 2, fz: 1, label: "the permit window" }],
      spots([[18, 14], [30, 38], [76, 42], [100, 14], [14, 38], [98, 38], [38, 9], [74, 8]], "in the square")),
    weights: { bench: 0.3, spot: 0.28, stall: 0.1, cart: 0.12, queue: 0.07, stroll: 0.13 }, phys: { wind: true, rooms: [] },
    beds: [], blurb: "An open-air square in front of the city hall. People come for an errand, a snack or a chat, and fresh air dilutes the virus.",
    objectives: { infected: 20, deaths: 2, trust: 55 } },
  market: { name: "Public market", type: "walk", risk: "Medium", pop: 700, days: 90, open: [5, 18], stay: 1.5, shout: 0.45, talk: 0.4, kf: 0.16, peaks: [6, 7, 8, 9, 16],
    speed: 0.8, freeMult: 1.2, freePop: 170, zones: [{ key: "aisles", name: "Aisles", W: 64, D: 34, ox: -32, oz: -17, obstacles: [[5.5, 14.4, 14.5, 19.6], [27.5, 14.4, 36.5, 19.6], [49.5, 14.4, 58.5, 19.6]] }], entrances: E0([[0, 7], [0, 27], [64, 7], [64, 27], [0, 17], [64, 17]]),
    pois: [0, 1, 2, 3, 4].map(k => ({ kind: "stall", x: 4 + 14 * k, z: -1.4, fz: 1, goods: MARKET_GOODS[k], vx: 4 + 14 * k, vz: -7.6 })).concat(
      [0, 1, 2, 3, 4].map(k => ({ kind: "stall", x: 4 + 14 * k, z: 35.4, fz: -1, goods: MARKET_GOODS[5 + k], vx: 4 + 14 * k, vz: 41.6 })),
      [0, 1, 2].map(k => ({ kind: "stall", x: 10 + 22 * k, z: 20.6, fz: 1, goods: MARKET_GOODS[10 + k], vx: 10 + 22 * k, vz: 13.2 })),
      spots([[21, 8], [43, 8], [21, 28], [43, 28], [58, 9], [58, 27]], "in the aisle")),
    weights: { stall: 0.72, spot: 0.1, stroll: 0.18 }, phys: { rooms: [{ zone: 0, x0: -10, z0: -10, x1: 74, z1: 44, V: 4700, ach: 10, name: "under the market roof" }] },
    beds: [], blurb: "A covered market. Vendors stand behind their stalls all day while shoppers browse, buy and carry their bags down narrow aisles.",
    objectives: { infected: 35, deaths: 3, trust: 55 } },
  jeepney: { name: "Jeepney ride", type: "jeep", risk: "Very high", pop: 99, days: 60, kf: 3, phys: { rooms: [{ zone: 0, x0: -5, z0: -30, x1: 12, z1: 30, V: 14, ach: 35, cabin: true, name: "the jeep cabin" }] },
    zones: [{ key: "jeep", name: "Inside the jeep", W: 7, D: 26, ox: 396.5, oz: -13 }, { key: "queue", name: "Jeepney stop", W: 140, D: 50, ox: -70, oz: -25 }],
    beds: [], seats: 16, blurb: "Sixteen passengers sit knee to knee on two facing benches, with the driver and one more passenger in front. The same driver carries every load.",
    objectives: { infected: 45, deaths: 1, trust: 60 } },
  university: { name: "University campus", type: "walk", risk: "Medium", pop: 700, days: 90, open: [7, 19], stay: 2, talk: 0.35, kf: 0.36, bell: [9, 11, 13, 15, 17], peaks: [10, 12, 12, 15, 17],
    speed: 0.9, freeMult: 1.1, freePop: 350, zones: [{ key: "field", name: "Campus field", W: 112, D: 80, ox: -56, oz: -40, obstacles: [[78.8, 5.4, 81.2, 6.6], [84.8, 5.4, 87.2, 6.6], [90.8, 5.4, 93.2, 6.6]] }],
    entrances: E0([[34, 79], [78, 79], [0, 66], [112, 66]]).concat([26, 46, 66].map(x => ({ x, z: -6, zone: 0, door: 1 }))),
    pois: [[80, 13.5], [86, 13.5], [92, 13.5], [38, 30], [38, 52], [60, 69], [84, 69]].map(([x, z]) => ({ kind: "bench", x, z, label: "on a campus bench" })).concat(
      [{ kind: "cart", x: 40, z: 65.4, fz: 1, goods: "fishballs", label: "the fishball cart", vx: 40, vz: 61.8, prop: "cart" }],
      [80, 86, 92].map(x => ({ kind: "table", x, z: 6, label: "at a canteen table" })),
      spots([[15, 20], [20, 45], [50, 40], [70, 35], [90, 50], [60, 56], [100, 30], [48, 12], [18, 62], [80, 60]], "on the field")),
    weights: { bench: 0.22, table: 0.2, spot: 0.33, cart: 0.1, stroll: 0.15 },
    phys: { wind: true, rooms: [{ zone: 0, x0: 18, z0: -12, x1: 74, z1: 5, V: 300, ach: 6, name: "the covered corridor" }, { zone: 0, x0: 76, z0: 0, x1: 96, z1: 12, V: 250, ach: 20, name: "the canteen" }] },
    beds: [], blurb: "A wide green field between classroom buildings. Students walk in small groups, eat together at canteen tables, and crowd the covered corridor when the bell rings for a class change.",
    objectives: { infected: 20, deaths: 2, trust: 55 } },
  hospital: { name: "Public hospital", type: "hospital", risk: "High", pop: 220, days: 75, open: [8, 20], stay: 3, talk: 0.4, kf: 0.38, peaks: [8, 9, 10, 14, 15],
    zones: [{ key: "ward", name: "Inside the ward", W: 80, D: 9.5, ox: -40, oz: -6 }, { key: "yard", name: "Outside", W: 112, D: 46, ox: 344, oz: -16 }],
    beds: bedRow(-30, 30, 10, -12.1, Math.PI, 0).map(b => ({ x: b.x + 40, z: b.z + 6, yaw: Math.PI, zone: 0 }))
      .concat(bedRow(-30, 30, 10, 7.6, 0, 0).map(b => ({ x: b.x + 40, z: b.z + 6, yaw: 0, zone: 0 })))
      .concat(bedRow(-31.5, 31.5, 9, -2.4, Math.PI, 1).map(b => ({ x: b.x + 56, z: b.z + 16, yaw: Math.PI, zone: 1, overflow: true })))
      .concat(bedRow(-31.5, 31.5, 9, 9.6, Math.PI, 1).map(b => ({ x: b.x + 56, z: b.z + 16, yaw: Math.PI, zone: 1, overflow: true }))),
    ypois: [{ kind: "desk", zone: 0, x: 78, z: 17.2, vx: 79.6, vz: 24.4 }].concat([-44, -30, 30, 44].flatMap(x => [{ kind: "bench", x: x + 56, z: 36 }, { kind: "bench", x: x + 56, z: 42 }]), [[6, 26], [106, 26], [44, 42], [68, 42], [106, 8]].map(([x, z]) => ({ kind: "spot", x, z }))),
    entrances: [{ x: 84, z: 5, zone: 0, door: 1 }].concat([20, 56, 92].map(x => ({ x, z: 45.5, zone: 1 }))), yardDoor: { x: 48, z: 1.5 },
    weights: { bench: 0.55, spot: 0.25, stroll: 0.2 },
    phys: { wind: true, rooms: [{ zone: 0, x0: -10, z0: -20, x1: 90, z1: 30, V: 1400, ach: 15, hepa: true, name: "the ward" }] },
    bedsTransmit: 1,
    blurb: "Doctors and nurses in protective gear care for patients in fourteen ward beds and in beds under tarps outside, where new patients go once the ward is full. Outpatients register, wait on benches, some in wheelchairs, and talk. Every infected nurse or doctor means fewer beds can be staffed.",
    objectives: { infected: 20, deaths: 1, trust: 50 } },
};
/* ---------------------------------------------------------------------------------------------------------
   Physics of spread: a two-zone model.
   Every infectious person emits "quanta" (infectious doses) at a rate set by what they are doing with their
   voice: quiet breathing 5 per hour, talking 30, shouting 150; a cough releases a burst of 25.
   1. Far field: inside an enclosed room the emitted quanta mix into the room air. Concentration C follows
        dC/dt = sum(q) / V - (ACH + decay) * C
      with V the room volume (m3) and ACH its air changes per hour. Open air has no far field.
   2. Near field: within reach (1.8 m; 3 m for a shout) and inside the cone the emitter is facing
      (60 degrees either side; 75 for a shout), a person breathes the jet directly:
        C_near = q * cos(angle) / (4 * pi * d^2 * K)
      K is a calibrated dilution constant (larger outdoors in wind, and in a ward with directional airflow).
   3. Dose: each susceptible person accumulates D += (C_far + C_near) * (1 - mask filtration) * breathing rate * time.
      Each place also has a factor kf on K, calibrated so that with no response it produces an outbreak of believable size.
      Every person carries a hidden threshold drawn from an exponential distribution; infection happens when D
      crosses it. This is exactly the Wells-Riley chance 1 - exp(-D), but you can watch the dose build up.
   Masks filter both ways; face shields stop the near-field jet but not room air; N95 PPE blocks 95%.
   Two people walking past each other are within reach for about 2 real seconds, so passing adds almost nothing.
   --------------------------------------------------------------------------------------------------------- */
const SUB = 12, DT = 1 / SUB;                         // sub-steps per hour; hours per sub-step
const Q = [5, 30, 150], COUGH_Q = 25;                // quanta per hour: breathe, talk, shout; quanta per cough
const BREATH = 0.5, DECAY = 0.7;                      // m3 breathed per hour; per-hour virus decay plus settling
const NEAR_R = [1.8, 1.8, 3.0], CONE = [Math.PI / 3, Math.PI / 3, Math.PI * 5 / 12], COUGH_R = 2.0, COUGH_CONE = Math.PI / 4;
const PASS_S = 2;                                     // real seconds two walkers spend within reach when they pass
const WALK = 3.0;                                     // units walked per 5-minute sub-step
const M = { AWAY: 0, MOVE: 1, DWELL: 2, CONVERSE: 3, DEPART: 4, WANDER: 5, FOLLOW: 6, FIXED: 7 };
const VOICE = ["breathing", "talking", "shouting"];
/* What people do with each other. Used to describe each logged interaction; the infection chance itself comes from the physics. */
const KINDS = { buy: "buying from a vendor", cart: "eating at a street-food cart", queue: "queuing", desk: "registering at the desk", sit: "sitting together", food: "sharing food on a bench",
  table: "eating at a canteen table", chat: "chatting in a group", talk: "stopping to talk", cohort: "walking together", pass: "walking past", air: "breathing the same room air",
  beside: "sitting side by side", facing: "sitting face to face", near: "sitting one seat away", fare: "passing the fare", wait: "waiting at the stop", check: "a check at the bedside",
  procedure: "a long bedside procedure", bedside: "a bedside visit", waitroom: "waiting outside", handover: "a shift handover", home: "living in the same household", shout: "a vendor shouting nearby" };
const SEATED = { bench: 1, table: 1 }, OFFS = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5];
const GUARDS = { bhw: { name: "Barangay health worker", stop: 0.05, wrong: 0.4, daily: 0.08 }, police: { name: "Police officer", stop: 0.15, wrong: 0.9, daily: 0 }, soldier: { name: "Soldier", stop: 0.3, wrong: 1.4, daily: -0.1 } };
const jeepPop = loads => 1 + Math.round(loads * 17 * 0.72);
/* slots: where each person stands or sits at a place, and which way they face */
function buildSlots(p) {
  const S = [], k = p.kind, add = (x, z, yaw, pose) => S.push({ x, z, yaw, pose: pose || 0 });
  if (k === "stall") { for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) add(p.x + (c - 1) * 2.2, p.z + p.fz * r * 2.2, p.fz > 0 ? Math.PI : 0); }
  else if (k === "cart") { for (const a of [-60, -30, 0, 30, 60]) { const r = a * Math.PI / 180, x = p.x + 2.4 * Math.sin(r), z = p.z + p.fz * 2.4 * Math.cos(r); add(x, z, Math.atan2(p.x - x, p.z - z)); } }
  else if (k === "queue") { for (let q = 0; q < 8; q++) add(p.x + (q % 2 ? 0.35 : -0.35), p.z + p.fz * q * 1.8, p.fz > 0 ? Math.PI : 0); }
  else if (k === "desk") { for (let q = 0; q < 10; q++) add(p.x + (q % 2) * 1.7 - 0.85, p.z - Math.floor(q / 2) * 1.8, 0); }
  else if (k === "bench") { const fy = p.cx != null ? Math.atan2(p.x - p.cx, p.z - p.cz) : (p.fy || 0), ax = Math.cos(fy), az = -Math.sin(fy), fx = Math.sin(fy), fz = Math.cos(fy);
    for (let q = 0; q < 3; q++) add(p.x + ax * (q - 1) * 1.25, p.z + az * (q - 1) * 1.25, fy, 1);
    for (let q = 0; q < 3; q++) add(p.x + fx * 2.1 + ax * (q - 1) * 1.4, p.z + fz * 2.1 + az * (q - 1) * 1.4, fy + Math.PI); }
  else if (k === "table") { for (const [dx, dz, yaw] of [[-0.95, -1.35, 0], [0.95, -1.35, 0], [-0.95, 1.35, Math.PI], [0.95, 1.35, Math.PI]]) add(p.x + dx, p.z + dz, yaw, 1); }
  else { for (let q = 0; q < 6; q++) { const a = q / 6 * 6.2832 + 0.4, x = p.x + 2.0 * Math.sin(a), z = p.z + 2.0 * Math.cos(a); add(x, z, a + Math.PI); } }
  p.slots = S; if (p.vx != null) { p.phx = p.x; p.phz = p.z - (p.fz || 1) * (k === "cart" ? 1.0 : 1.6); }
}
for (const e of Object.values(ENVS)) { for (const p of e.pois || []) buildSlots(p); for (const p of e.ypois || []) buildSlots(p); }

const DEFAULTS = {
  env: "cityhall", population: 300, initial: 3, profile: "ph", maxDays: 60,
  // the virus. beta multiplies every emission rate (a more transmissible variant emits more quanta)
  beta: 1.0, incubation: 5, infectious: 7, untilSevere: 7, severeDays: 10, fatality: 1.0,
  silent: 0.30, silentInfectivity: 0.6, variation: 0.2, longRecovery: false, household: 0.025,
  // air and breath (see the physics section). qScale converts the quanta rates above into infectious doses and
  // nearK is the near-field dilution; both were calibrated so the locations give believable outbreak sizes.
  qScale: 0.5, nearK: 1.6, achScale: 1, wind: 1.5, coughRate: 1, jeepTraffic: 0.5,
  // daily routine
  routines: true, walkMode: "life", stay: null, regulars: 0.5, sickStay: 0.3, loads: 8, windowsOpen: true,
  // testing and reporting
  testRate: 0.7, reportDelay: 3,
  // response measures (share of people, 0..1); filtration of masks and shields (assumptions)
  mask: 0, maskSource: 0.5, maskWearer: 0.3, shield: 0, shieldSource: 0.6, shieldWearer: 0.5, sickOnly: false,
  vax: 0, vaxInfection: 0.6, vaxSevere: 0.7, dist: 0, iso: 0, isoDelay: 1, trace: 0, traceDelay: 1,
  guard: 0, guardType: "bhw", guardNotice: 0.2, guardAccuracy: 0.85, guardDelay: 0, guardComply: 0.8, guardDays: 10, guardFalse: 0.003,
  // immunity and care; ppe = N95 filtration for hospital staff, ppeBreach = chance a bedside check breaches it
  waneDays: 120, wanePlateau: 60, infectionProtection: 0.95, noBedRisk: 2.0, overflowRisk: 1.3, ppe: 0.95, ppeBreach: 0.03,
  // behaviour
  trustStart: 75, trustEffect: true,
  // historical replay: per-day multiplier on emission, per-day vaccinated share (0..1)
  betaSchedule: null, vaxSchedule: null, importSchedule: null, track: null,
  stepsPerDay: 24,
};

function mulberry32(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class Sim {
  constructor(P, seed, opts) {
    this.P = P; this.seed = seed; this.env = ENVS[P.env]; this.log = !opts || opts.log !== false;
    const rnd = this.rnd = mulberry32(seed * 2654435761 + 12345), n = this.n = P.population, env = this.env;
    const f32 = () => new Float32Array(n), u8 = () => new Uint8Array(n), i16 = v => new Int16Array(n).fill(v), f64 = v => new Float64Array(n).fill(v);
    this.x = f32(); this.z = f32(); this.px = f32(); this.pz = f32(); this.hd = f32(); this.yaw = f32();
    this.zone = u8(); this.pose = u8();                       // pose: 0 standing, 1 seated, 2 lying
    this.away = u8().fill(1);                                  // away = not in the scene (home, isolation, off-site)
    this.state = u8(); this.timer = f32(); this.tInfectious = f32();
    this.silent = u8(); this.fateSevere = u8(); this.frailty = f32(); this.mildSteps = f32(); this.severeSteps = f32(); this.pSev = f32();
    this.reportAt = f64(Infinity); this.reported = u8(); this.revealed = u8(); this.tested = u8();
    this.isolated = u8(); this.quarantined = u8(); this.traceAt = f64(Infinity); this.isoAt = f64(Infinity); this.homeUntil = f64(Infinity); this.guardAt = f64(Infinity);
    this.qWhy = u8(); this.qDay = f32().fill(-1);              // why this person was sent home: 1 positive test, 2 traced contact, 3 guard, 4 player
    this.bed = i16(-1); this.noBed = u8();
    this.infBy = new Int32Array(n).fill(-1); this.infDay = f32().fill(-1); this.infectiousDay = f32().fill(-1); this.severeDay = f32().fill(-1); this.outDay = f32().fill(-1);
    this.infections = u8(); this.kids = []; this.infHow = new Array(n).fill(null); this.recoveredAt = f64(-Infinity);
    this.vaccinated = u8(); this.vaxAt = f64(-Infinity);
    this.rMask = f32(); this.rVax = f32(); this.rDist = f32(); this.rIso = f32(); this.rShield = f32();
    this.age = u8(); this.ageGroup = u8(); this.gender = u8(); this.persona = u8(); this.comorbid = u8(); this.look = new Float32Array(n * 4); this.role = u8(); this.sub = u8();
    // daily life
    this.regular = u8(); this.go = u8(); this.arrive = i16(-1); this.leave = i16(-1); this.visited = u8(); this.act = u8(); this.poi = i16(-1); this.home = i16(-1);
    this.bag = u8(); this.wheel = u8(); this.testAt = f64(Infinity); this.ptest = u8(); this.ptestDay = f32().fill(-1); this.ppe = u8(); this.seat = new Int8Array(n).fill(-1); this.am = new Int8Array(n).fill(-1); this.pm = new Int8Array(n).fill(-1); this.pref = f32(); this.shift = u8(); this.visits = i16(-1);
    // movement: mode, target, slot, activity timer, conversation partner, group leader, voice
    this.mode = u8(); this.tgx = f32(); this.tgz = f32(); this.poiK = i16(-1); this.slotK = new Int8Array(n).fill(-1); this.at = new Int16Array(n); this.wt = new Int16Array(n);
    this.partner = new Int32Array(n).fill(-1); this.leader = new Int32Array(n).fill(-1); this.fol = u8(); this.convEnd = new Int32Array(n).fill(-99);
    this.arrSub = u8(); this.depSub = u8(); this.voc = u8(); this.vdur = new Float32Array(n).fill(1); this.say = new Int32Array(n).fill(-1); this.eat = u8(); this.stuck = u8(); this.toYard = u8(); this.sx0 = f32(); this.sz0 = f32();
    // physics: position in metres, room, dose breathed in, and the hidden infection threshold
    this.here = []; this._joined = []; this.stamp = new Int32Array(n); this.tick = 0; this.arrQ = new Map();
    this.mH = u8(); this.dH = u8(); this.shH = u8(); this.susH = f32(); this.hs = new Int32Array(n); this.gHead = new Int32Array(1 << 14).fill(-1); this.gNext = new Int32Array(n); this.gUsed = [];
    this.mx = f32(); this.mz = f32(); this.room = new Int8Array(n).fill(-1); this.dose = new Float64Array(n); this.doseDay = f32(); this.thr = new Float64Array(n); this.breach = u8();
    this.diary = Array.from({ length: n }, () => []); this.inter = []; this.contacts = [];
    this.cost = { maskDays: 0, shieldDays: 0, homeDays: 0, sickDays: 0, stops: 0, falseAlarms: 0, guardCaught: 0 }; this.driver = { loads: 0, exposedLoads: 0, carried: 0 }; this.byKind = {};
    // people: their own random stream, so the same seed gives the same crowd whatever the virus settings
    const pr = this.pr = mulberry32(seed * 40503 + 777), share = AGE_SHARE[P.profile] || AGE_SHARE.ph;
    for (let i = 0; i < n; i++) {
      let u = pr(), g = 0; while (g < 3 && u > share[g]) { u -= share[g]; g++; }
      this.ageGroup[i] = g; this.age[i] = AGE_RANGE[g][0] + Math.floor(pr() * (AGE_RANGE[g][1] - AGE_RANGE[g][0] + 1));
      this.gender[i] = pr() < 0.5 ? 0 : 1; const q = pr(); const ps = q < 0.25 ? 0 : q < 0.5 ? 1 : q < 0.8 ? 2 : 3; this.persona[i] = ps;
      this.comorbid[i] = pr() < COMORBIDITY[g] ? 1 : 0;
      const comp = Math.min(1, Math.max(0, PERSONAS[ps][2] + (pr() - 0.5) * 0.3));
      // rank in [0,1): low rank = adopts a measure early. Each measure mixes the personal compliance with its own noise.
      for (const key of ["rMask", "rVax", "rDist", "rIso", "rShield"]) this[key][i] = 1 - (0.6 * comp + 0.4 * pr());
      for (let k = 0; k < 4; k++) this.look[i * 4 + k] = pr();
      this.regular[i] = pr() < P.regulars ? 1 : 0; this.pref[i] = pr(); this.kids.push(null);
    }
    this.frailtyStream = mulberry32(seed * 7919 + 31);
    for (let i = 0; i < n; i++) this.frailty[i] = this.frailtyStream();
    this.beds = env.beds.map(b => Object.assign({ by: -1 }, b)); this.bedLimit = this.beds.length;
    this.t = 0; this.trust = P.trustStart; this.queue = []; this.riders = []; this.leftover = [];
    if (env.type === "jeep") this._initJeep(); else if (env.type === "hospital") this._initHospital(); else this._initWalk();
    for (const key of ["rMask", "rVax", "rDist", "rIso", "rShield"]) { // turn scores into exact ranks so "80%" means 80% of people
      const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => this[key][a] - this[key][b]); idx.forEach((i, k) => this[key][i] = k / n);
    }
    // households: family members infect each other at home, whatever happens in the scene
    const order = Array.from({ length: n }, (_, i) => i).filter(i => !(env.type === "hospital" && this.role[i] === 4)); for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(pr() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    this.house = []; this.hh = new Int32Array(n).fill(-1); for (let k = 0; k < order.length;) { const u = pr(), size = u < 0.08 ? 1 : u < 0.22 ? 2 : u < 0.42 ? 3 : u < 0.66 ? 4 : u < 0.86 ? 5 : 6, m = order.slice(k, k + size); m.forEach(i => this.hh[i] = this.house.length); this.house.push(m); k += size; }
    for (let i = 0; i < n; i++) { this.hd[i] = rnd() * 6.2831853; this.px[i] = this.x[i]; this.pz[i] = this.z[i]; }
    this.totals = { infections: 0, reinfections: 0, reported: 0, deaths: 0, severe: 0, noBed: 0 };
    this.pressure = 0; this.pressureLog = []; this.curMult = 1; this.bm = 1; this.betaUsed = []; this.importUsed = [];
    this._day = { inf: 0, rep: 0, deaths: 0, sev: 0 }; this.hist = []; this.deathDelays = []; this.caseDay = []; this._ev = [];
    this._applyVaccination(true);
    let placed = 0, guard = 0; const k = Math.min(P.initial, n);   // seed infections among ordinary visitors
    while (placed < k && guard++ < n * 20) { const i = Math.floor(rnd() * n); if (this.state[i] === HEALTHY && !this.role[i]) { this._infect(i, -1, true); placed++; } }
    this.pend = new Map();
    this.thrStream = mulberry32(seed * 92821 + 7); for (let i = 0; i < n; i++) this.thr[i] = -Math.log(1 - this.thrStream());
    this.rooms = ((env.phys && env.phys.rooms) || []).map(r => Object.assign({}, r, { ach0: r.ach, C: 0, Cavg: 0, E: 0, src: [] }));
    this.nearAcc = new Float64Array(n); this.cH = new Int32Array(n).fill(-1); this.cS = new Int32Array(4096); this.cW = new Float64Array(4096); this.cD = new Float32Array(4096); this.cN = new Int32Array(4096);
    this.occ = this._pois().map(p => new Int32Array(p.slots.length).fill(-1)); this.freeN = this._pois().map(p => p.slots.length); this.foodBench = new Uint8Array(this._pois().length);
    for (const b of this.beds) b.vis = [-1, -1];
    this.windDir = 0; this.windSpd = P.wind; this.stuckFrom = 99; this.stuckTo = -1; this.fares = []; this.chatters = [];
    if (this.log) { const N = (SUB + 1) * n; this.K = { x: new Float32Array(N), z: new Float32Array(N), yaw: new Float32Array(N), vis: new Uint8Array(N), pose: new Uint8Array(N), voc: new Uint8Array(N), say: new Int32Array(N), zone: new Uint8Array(N), dose: new Float32Array(N), act: new Uint8Array(N) };
      this.kC = new Float32Array((SUB + 1) * Math.max(1, this.rooms.length)); this.kev = Array.from({ length: SUB + 1 }, () => ({ cough: [], near: [], pass: [], say: [], inf: [], breach: [] })); }
    if (!P.routines && env.type === "walk") this._placeAll();
    if (this.log) for (let k = 0; k <= SUB; k++) this._key(k);
    this._record();
  }
  /* ---------- helpers ---------- */
  gammaK(meanDays, k) { const r = this.rnd; let p = 1; for (let q = 0; q < k; q++) p *= r() || 1e-12; return Math.max(1, -(meanDays / k) * Math.log(p) * this.P.stepsPerDay); }
  gamma4(meanDays) { return this.gammaK(meanDays, 4); }
  get day() { return this.t / this.P.stepsPerDay; }
  get hour() { return this.t % 24; }
  counts() { const c = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < this.n; i++) c[this.state[i]]++; return c; }
  compliance() { return this.P.trustEffect ? 0.55 + 0.45 * this.trust / 100 : 1; }
  symptomatic(i) { return this.state[i] === INFECTIOUS && !this.silent[i] && this.tInfectious[i] >= 12; }
  noticedSick(i) { return this.state[i] === INFECTIOUS && !this.silent[i] && (this.reported[i] || this.tInfectious[i] >= 24); }
  masked(i) { if (this.ppe[i] || (this.env.type === "hospital" && this.role[i] >= 1 && this.role[i] <= 3)) return true;   // every member of hospital staff wears a mask
    return (this.P.sickOnly ? this.noticedSick(i) : true) && this.rMask[i] < this.P.mask * this.compliance(); }
  shielded(i) { if (this.ppe[i]) return true; return (this.P.sickOnly ? this.noticedSick(i) : true) && this.rShield[i] < this.P.shield * this.compliance(); }
  distancing(i) { return this.rDist[i] < this.P.dist * this.compliance(); }
  willIsolate(i) { return this.rIso[i] < this.P.iso * this.compliance(); }
  wane(sinceSteps) { const d = sinceSteps / this.P.stepsPerDay - this.P.wanePlateau; return d <= 0 ? 1 : Math.pow(0.5, d / this.P.waneDays); }   // holds for a plateau, then halves every waneDays
  vaccineProtection(i) { return this.vaccinated[i] ? this.wane(this.t - this.vaxAt[i]) : 0; }
  susceptibility(i) { // 0 = fully protected, 1 = fully susceptible
    let s = 1; if (this.vaccinated[i]) s *= 1 - this.P.vaxInfection * this.vaccineProtection(i);
    if (this.state[i] === RECOVERED) s *= 1 - this.P.infectionProtection * this.wane(this.t - this.recoveredAt[i]);
    return s;
  }
  blocked(i) { const s = this.state[i]; return s === DECEASED || this.isolated[i] || this.quarantined[i] || (s === SEVERE && this.bed[i] < 0); }
  contagious(i) { const s = this.state[i]; return s === INFECTIOUS || (s === SEVERE && this.bed[i] >= 0 && !!this.env.bedsTransmit); }
  _applyVaccination(initial) {
    const P = this.P, d = Math.floor(this.day), cov = P.vaxSchedule ? (P.vaxSchedule[Math.min(d, P.vaxSchedule.length - 1)] || 0) + (P.vaxBoost || 0) : P.vax;
    for (let i = 0; i < this.n; i++) if (!this.vaccinated[i] && this.rVax[i] < cov && this.state[i] !== DECEASED) {
      this.vaccinated[i] = 1; this.vaxAt[i] = initial ? this.t - this.frailtyStream() * 60 * P.stepsPerDay : this.t;
    }
  }
  _adult(i) { if (this.ageGroup[i] === 0 || this.ageGroup[i] === 3) { this.ageGroup[i] = 1 + (this.pr() < 0.45 ? 1 : 0); this.age[i] = AGE_RANGE[this.ageGroup[i]][0] + Math.floor(this.pr() * 20); } }
  /* ---------- who is who in each location ---------- */
  _initWalk() { let v = 0; this.vendors = []; this.vendorOf = this.env.pois.map((p, k) => { if (p.vx == null || v >= this.n) return -1; const i = v++; this.role[i] = 2; this.home[i] = k; this.regular[i] = 1; this._adult(i); this.vendors.push(i); return i; }); }
  _initJeep() { // person 0 drives every load; everyone else is a commuter with a usual morning and evening load
    const L = this.P.loads, half = L / 2; this.role[0] = 3; this._adult(0); this.regular[0] = 1;
    const ids = Array.from({ length: this.n - 1 }, (_, k) => k + 1), sh = ids.slice(); for (let k = sh.length - 1; k > 0; k--) { const j = Math.floor(this.pr() * (k + 1)); [sh[k], sh[j]] = [sh[j], sh[k]]; }
    ids.forEach((i, k) => this.am[i] = k % half); sh.forEach((i, k) => this.pm[i] = half + k % half);
  }
  _initHospital() { // roles: 1 doctor, 2 nurse, 3 other staff (guard, cleaner, receptionist), 4 inpatient, 5 ward visitor, 0 outpatient
    const n = this.n, nd = HOSP_STAFF.doctors, nn = HOSP_STAFF.nurses, no = HOSP_STAFF.other, np = Math.min(14, this.beds.length), nv = Math.round((n - nd - nn - no - np) * 0.32); let i = 0;   // staff numbers never change with population
    for (let k = 0; k < nd; k++, i++) { this.role[i] = 1; this.ppe[i] = 1; this.shift[i] = k % 2; this._adult(i); }
    for (let k = 0; k < nn; k++, i++) { this.role[i] = 2; this.ppe[i] = 1; this.shift[i] = k % 2; this._adult(i); }
    for (let k = 0; k < no; k++, i++) { this.role[i] = 3; this.sub[i] = k % 3; this.shift[i] = k < 3 ? 0 : (k % 2); this._adult(i); }
    const slots = [0, 1, 2, 3, 7, 8, 9, 10, 15, 17, 19, 24, 26, 28]; this.inpatients = [];
    for (let k = 0; k < np; k++, i++) { this.role[i] = 4; this.ageGroup[i] = this.pr() < 0.6 ? 3 : 2; this.age[i] = AGE_RANGE[this.ageGroup[i]][0] + Math.floor(this.pr() * 20); this.comorbid[i] = 1; const b = this.beds[slots[k]]; b.by = i; this.bed[i] = slots[k]; this.away[i] = 0; this.zone[i] = b.zone; this.x[i] = b.x; this.z[i] = b.z; this.yaw[i] = b.yaw; this.pose[i] = 2; this.mode[i] = M.FIXED; this.inpatients.push(i); }
    for (let k = 0; k < nv; k++, i++) { this.role[i] = 5; this.visits[i] = this.inpatients[k % np]; }
    for (let j = 0; j < i; j++) if (this.role[j] >= 1 && this.role[j] <= 3) this.regular[j] = 1;
    let rec = -1; for (let j = 0; j < i; j++) if (this.role[j] === 3 && this.sub[j] === 2) { rec = j; break; } this.vendorOf = this.env.ypois.map((q, p) => p === 0 ? rec : -1);
    for (let j = i; j < n; j++) this.wheel[j] = (this.ageGroup[j] === 3 && this.pr() < 0.7) || (this.comorbid[j] && this.pr() < 0.5) || this.pr() < 0.06 ? 1 : 0;   // some outpatients come in a wheelchair
  }
  /* ---------- infection: the person's fate is fixed here ---------- */
  _infect(i, by, seedCase, how) {
    const P = this.P, r = this.rnd, g = this.ageGroup[i], spd = P.stepsPerDay, v = P.longRecovery ? Math.min(0.5, P.variation * 2) : P.variation;
    const re = this.state[i] === RECOVERED; if (re) this.totals.reinfections++;
    this.infections[i]++; this.totals.infections++; this._day.inf++;
    this.silent[i] = r() < P.silent * (g === 3 ? 0.6 : 1) ? 1 : 0;
    const pSev = Math.min(0.9, P_SEVERE[g] * (this.comorbid[i] ? 2 : 1) * (1 - P.vaxSevere * this.vaccineProtection(i)) * (re ? 0.5 : 1)); this.pSev[i] = pSev;
    this.fateSevere[i] = !this.silent[i] && r() < pSev ? 1 : 0;
    const vary = () => 1 - v + 2 * v * r();
    this.mildSteps[i] = this.fateSevere[i] ? P.untilSevere * vary() * spd : P.longRecovery ? this.gammaK(P.infectious * 1.5, 2) : this.gamma4(P.infectious);
    this.severeSteps[i] = P.severeDays * vary() * spd * (P.longRecovery ? 1.3 : 1);
    this.infBy[i] = by; this.infDay[i] = this.day; this.infectiousDay[i] = -1; this.severeDay[i] = -1; this.outDay[i] = -1; this.reported[i] = 0; this.revealed[i] = 0; this.qWhy[i] = 0; this.qDay[i] = -1;
    this.infHow[i] = how || { k: seedCase ? "seed" : "import" }; const kk = this.infHow[i].k; this.byKind[kk] = (this.byKind[kk] || 0) + 1;
    this.caseDay.push(this.day);
    if (by >= 0) (this.kids[by] = this.kids[by] || []).push(i);
    const inc = seedCase ? 0 : this.gamma4(P.incubation);
    // testing: symptomatic people may get tested; the result arrives some days after symptoms start
    this.tested[i] = !this.silent[i] && r() < P.testRate ? 1 : 0;
    this.reportAt[i] = this.tested[i] ? this.t + inc + (1 + P.reportDelay * (0.6 + 0.8 * r())) * spd : Infinity;
    if (seedCase) { this.state[i] = INFECTIOUS; this.timer[i] = this.mildSteps[i]; this.tInfectious[i] = 0; this.infectiousDay[i] = this.day; }
    else { this.state[i] = EXPOSED; this.timer[i] = inc; }
  }
  /* ---------- the start of each day: who goes out today, the wind, and what happened at home overnight ---------- */
  _planDay() {
    const P = this.P, env = this.env, n = this.n, rnd = this.rnd, st = this.state;
    if (this.log) { for (let i = 0; i < n; i++) this.diary[i].length = 0; if (this.inter.length > 600) this.inter.splice(0, this.inter.length - 400); }
    this.doseDay.fill(0);
    this.windDir = rnd() * 6.2832; this.windSpd = P.wind * (0.5 + rnd());
    // household spread: an infectious person at home can infect family members
    if (P.household > 0) for (let i = 0; i < n; i++) { if (!(st[i] === INFECTIOUS || (st[i] === SEVERE && this.noBed[i])) || this.hh[i] < 0) continue; const sf = this.silent[i] ? P.silentInfectivity : 1;
      for (const j of this.house[this.hh[i]]) { if (j === i || (st[j] !== HEALTHY && st[j] !== RECOVERED) || this.pend.has(j) || this.bed[j] >= 0) continue; const sus = this.susceptibility(j); if (sus <= 0.02) continue;
        this.pressure += P.household * sus * sf; if (rnd() < Math.min(1, P.household * this.bm * sus * sf)) this.pend.set(j, [i, { t: this.t, s: 0, a: i, b: j, k: "home", r: "home", d: 0.5, m: 600, p: -1, inf: 1 }]); } }
    const open = env.open || [0, 24], stay = P.stay || env.stay || 2;
    for (let i = 0; i < n; i++) { this.visited[i] = 0; this.bag[i] = 0; const sick = this.symptomatic(i) && rnd() < P.sickStay, r = this.role[i];
      if (env.type === "jeep") { this.go[i] = !sick && (i === 0 || !P.routines || rnd() < (this.regular[i] ? 0.75 : 0.35)) ? 1 : 0; continue; }
      if (env.type === "hospital" && r >= 1 && r <= 3) { this.go[i] = sick ? 0 : 1; continue; }
      if (env.type === "hospital" && r === 4) { this.go[i] = 1; continue; }
      if (r === 2) { this.go[i] = sick ? 0 : 1; this.arrive[i] = open[0]; this.leave[i] = open[1]; continue; }
      if (!P.routines) { this.go[i] = 1; this.arrive[i] = 0; this.leave[i] = 99; continue; }
      const pv = env.type === "hospital" ? (r === 5 ? (this.regular[i] ? 0.8 : 0.3) : 0.75) : (this.regular[i] ? 0.9 : 0.4); this.go[i] = !sick && rnd() < pv ? 1 : 0; if (!this.go[i]) continue;
      const a = rnd() < 0.6 ? env.peaks[Math.floor(rnd() * env.peaks.length)] : open[0] + Math.floor(rnd() * (open[1] - open[0]));
      this.arrive[i] = Math.min(open[1] - 1, a); this.leave[i] = Math.min(open[1], this.arrive[i] + 1 + Math.min(5, Math.floor(-Math.log(rnd() || 1e-9) * Math.max(0.01, stay - 1) + 0.5)));
      this.arrSub[i] = Math.floor(rnd() * SUB); this.depSub[i] = Math.floor(rnd() * 6);
    }
    // students come in small groups that walk, sit and leave together
    if (env === ENVS.university && P.routines) { for (let i = 0; i < n; i++) if (this.leader[i] >= 0 && this.away[i]) this.leader[i] = -1;
      const byHour = {}; for (let i = 0; i < n; i++) if (this.go[i] && !this.role[i] && this.away[i]) (byHour[this.arrive[i]] = byHour[this.arrive[i]] || []).push(i);
      for (const L of Object.values(byHour)) { for (let k = L.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [L[k], L[j]] = [L[j], L[k]]; }
        for (let k = 0; k < L.length;) { const u = rnd(), size = u < 0.35 ? 1 : u < 0.65 ? 2 : u < 0.85 ? 3 : 4, G = L.slice(k, k + size); k += size;
          G.forEach((i, f) => { if (!f) return; this.leader[i] = G[0]; this.fol[i] = f; this.leave[i] = this.leave[G[0]]; this.arrSub[i] = this.arrSub[G[0]]; this.depSub[i] = this.depSub[G[0]]; }); } } }
    this.arrQ = new Map(); if (env.type === "walk" && P.routines) for (let i = 0; i < n; i++) if (this.go[i] && this.role[i] !== 2 && this.leader[i] < 0) { const key = this.arrive[i] * SUB + this.arrSub[i]; const L = this.arrQ.get(key); if (L) L.push(i); else this.arrQ.set(key, [i]); }
    if (env.type === "hospital") { let avail = 0; for (let i = 0; i < n; i++) if ((this.role[i] === 1 || this.role[i] === 2) && st[i] !== SEVERE && st[i] !== DECEASED && !this.isolated[i] && !this.quarantined[i] && this.go[i]) avail++; this.staffAvail = avail; this.bedLimit = Math.min(this.beds.length, Math.floor(avail * 1.5)); }
  }
  /* ======================================================================================================
     Movement. People walk at a steady pace (WALK units per 5-minute sub-step), go to a free slot at a stall,
     cart, bench, table, chat spot or queue, stay as long as the activity takes, then move on or leave through
     the nearest exit. Strollers who come within 1.5 m may stop to talk.
     ====================================================================================================== */
  _hit(z, x, y) { const o = this.env.zones[z] && this.env.zones[z].obstacles; if (o) for (const r of o) if (x > r[0] - 0.7 && x < r[2] + 0.7 && y > r[1] - 0.7 && y < r[3] + 0.7) return true; return false; }
  _free(x, z) { return !this._hit(0, x, z); }
  _speed(i) { const P = this.P; return WALK * (this.env.speed || 1) * (0.85 + 0.3 * PERSONAS[this.persona[i]][1] / 1.3) * (this.symptomatic(i) ? 0.8 : 1) * (this.wheel[i] ? 0.7 : 1) * (this.ageGroup[i] === 3 ? 0.85 : 1); }
  _stepTo(i, tx, tz, sp) { // walk up to sp units toward (tx, tz), sliding round obstacles; true on arrival
    const x = this.x[i], z = this.z[i], dx = tx - x, dz = tz - z, d = Math.sqrt(dx * dx + dz * dz);
    if (d <= sp) { this.x[i] = tx; this.z[i] = tz; if (d > 0.05) this.yaw[i] = Math.atan2(dx, dz); return true; }
    const a = Math.atan2(dx, dz), zi = this.zone[i], side = i % 2 ? 1 : -1;
    if (d < 3 || this.stuck[i] > 2) { this.x[i] = x + sp * dx / d; this.z[i] = z + sp * dz / d; this.yaw[i] = a; this.stuck[i] = 0; return false; }
    if (!this.env.zones[zi].obstacles) { this.x[i] = x + sp * dx / d; this.z[i] = z + sp * dz / d; this.yaw[i] = a; return false; }
    for (const off of OFFS) { const b = a + off * side, nx = x + sp * Math.sin(b), nz = z + sp * Math.cos(b);
      if (!this._hit(zi, nx, nz)) { this.x[i] = nx; this.z[i] = nz; this.yaw[i] = b; this.stuck[i] = off ? this.stuck[i] + 0.5 : 0; return false; } }
    this.stuck[i]++; return false;
  }
  _pois() { return this.env.pois || this.env.ypois || []; }
  _slotPos(p, s) { return this._pois()[p].slots[s]; }
  _freeCount(p) { return this.freeN[p]; }
  _take(i, p, s) { const q = this._pois()[p], sl = q.slots[s]; this.occ[p][s] = i; this.freeN[p]--; this.poiK[i] = p; this.slotK[i] = s; this.tgx[i] = sl.x; this.tgz[i] = sl.z; this.mode[i] = M.MOVE;
    const rnd = this.rnd, k = q.kind; this.at[i] = k === "stall" ? 2 + Math.floor(rnd() * 3) : k === "cart" ? 3 + Math.floor(rnd() * 4) : k === "bench" ? 4 + Math.floor(rnd() * 7) : k === "table" ? 6 + Math.floor(rnd() * 7) : k === "desk" ? 1 : k === "queue" ? 1 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 6);
    this.eat[i] = 0; this.foodBench = this.foodBench || new Uint8Array(this._pois().length); }
  _release(i) { const p = this.poiK[i]; if (p >= 0 && this.slotK[i] >= 0 && this.occ[p] && this.occ[p][this.slotK[i]] === i) { this.occ[p][this.slotK[i]] = -1; this.freeN[p]++; } this.poiK[i] = -1; this.slotK[i] = -1; this.eat[i] = 0; }
  _cohort(i) { const o = [i]; if (this.env !== ENVS.university) return o; for (let j = 0; j < this.n; j++) if (this.leader[j] === i && !this.away[j]) o.push(j); return o; }
  _choose(i, need, x, z) { // pick a place with enough free slots; nearer places are likelier
    const env = this.env, W = env.weights || {}, pois = this._pois(), rnd = this.rnd, dist = this.distancing(i), zi = this.zone[i];
    let tot = W.stroll || 0.1; const c = [];
    for (let p = 0; p < pois.length; p++) { const q = pois[p]; if ((q.zone || 0) !== zi || q.kind === "desk") continue; let w = W[q.kind] || 0; if (!w) continue;
      if (dist && q.kind !== "stall" && q.kind !== "queue") w *= 0.25; if (this._freeCount(p) < need) continue;
      const ex = q.x - x, ez = q.z - z; w /= 1 + Math.sqrt(ex * ex + ez * ez) / 10; c.push(p, w); tot += w; }
    let u = rnd() * tot; for (let q = 0; q < c.length; q += 2) { if ((u -= c[q + 1]) <= 0) return c[q]; } return -1;
  }
  _goTo(i, p) { // reserve slots for i (and its group) at place p
    const G = this._cohort(i), o = this.occ[p], q = this._pois()[p]; let g = 0;
    const sh = a => { for (let x = a.length - 1; x > 0; x--) { const y = Math.floor(this.rnd() * (x + 1)); [a[x], a[y]] = [a[y], a[x]]; } return a; };
    const order = q.kind === "queue" || q.kind === "desk" ? [...o.keys()] : q.kind === "bench" ? sh([0, 1, 2]).concat(sh([3, 4, 5])) : sh([...o.keys()]);
    for (const s of order) { if (g >= G.length) break; if (o[s] >= 0) continue; const j = G[g++]; this._release(j); this._take(j, p, s); if (q.kind === "queue" || q.kind === "desk") break; }
    if (q.kind === "bench" && this.rnd() < 0.5) this.foodBench[p] = 1;
    for (let f = g; f < G.length; f++) this._wander(G[f]);
  }
  _wander(i, cont) { const Z = this.env.zones[this.zone[i]], rnd = this.rnd, L = this.leader[i];
    if (!cont) { this._release(i); this.mode[i] = L >= 0 && !this.away[L] ? M.FOLLOW : M.WANDER; this.wt[i] = 2 + Math.floor(rnd() * 4); this.act[i] = this.mode[i] === M.FOLLOW ? 16 : this.env.type === "hospital" ? 12 : 0; }
    for (let g = 0; g < 12; g++) { const x = this.x[i] + (rnd() - 0.5) * 40, z = this.z[i] + (rnd() - 0.5) * 30;
      if (x > 2 && x < Z.W - 2 && z > 2 && z < Z.D - 2 && !this._hit(this.zone[i], x, z)) { this.tgx[i] = x; this.tgz[i] = z; return; } }
    this.tgx[i] = Z.W / 2; this.tgz[i] = Z.D / 2; }
  _next(i, h, k) { // after an activity: another one, a stroll, or home
    const P = this.P; if (this.leader[i] >= 0) return this._wander(i);
    const left = P.routines ? (this.leave[i] - h) * SUB - k : 99;
    if (P.walkMode !== "free" && left > 3 && this.rnd() < 0.7) { const p = this._choose(i, this._cohort(i).length, this.x[i], this.z[i]); if (p >= 0) return this._goTo(i, p); }
    this._wander(i); for (const j of this._cohort(i)) if (j !== i) this._wander(j);
  }
  _exits(x, z, door) { const E = this.env.entrances.filter(e => (e.zone || 0) === (this.env.type === "hospital" ? 1 : 0) && (door == null || this.env.bell || !!e.door === door)); return E.length ? E : this.env.entrances; }
  _nearest(list, x, z) { let b = list[0], bd = 1e9; for (const e of list) { const d = Math.hypot(e.x - x, e.z - z) + this.rnd() * 8; if (d < bd) { bd = d; b = e; } } return b; }
  _arrive(i, h) { // walk in through the entrance nearest to where they are going
    const P = this.P, env = this.env, rnd = this.rnd, G = [i]; if (env.bell) for (let j = 0; j < this.n; j++) if (this.leader[j] === i && this.go[j] && !this.blocked(j)) G.push(j);
    if (P.guard > 0) for (let g = G.length - 1; g >= 0; g--) if (this._guardCheck(G[g])) G.splice(g, 1); if (!G.length || G[0] !== i) { for (const j of G) this.leader[j] = -1; if (G[0] !== i) return; }
    const free = P.walkMode === "free", bell = env.bell && env.bell.includes(h) && !this.role[i];
    let p = -1; const any = this._exits(0, 0); let ent = any[Math.floor(rnd() * any.length)];
    if (bell) { const doors = env.entrances.filter(e => e.door); ent = doors[Math.floor(rnd() * doors.length)]; }
    for (const [f, j] of G.entries()) { const side = (f % 2 ? 1 : -1) * Math.ceil(f / 2) * 1.4; this._joined.push(j); this.away[j] = 0; this.visited[j] = 1; this.zone[j] = 0; this.pose[j] = 0; this.x[j] = ent.x + side + (rnd() - 0.5); this.z[j] = ent.z + (ent.z > 40 ? -0.5 : 0.5); this._note(j, "arrived"); }
    if (!free) p = this._choose(i, G.length, ent.x, ent.z);
    if (!bell && p >= 0) { const q = this._pois()[p], e = this._nearest(this._exits(q.x, q.z, false), q.x, q.z); for (const [f, j] of G.entries()) { const side = (f % 2 ? 1 : -1) * Math.ceil(f / 2) * 1.4; this.x[j] = e.x + side + (rnd() - 0.5); this.z[j] = e.z + (e.z > 40 ? -0.5 : 0.5); } }
    if (G.length > 1) for (let a = 0; a < G.length; a++) for (let b = a + 1; b < G.length; b++) this._log(G[a], G[b], "cohort", -1, 0.8, 30);
    if (p >= 0) this._goTo(i, p); else { this._wander(i); for (const j of G) if (j !== i) this._wander(j); }
  }
  _depart(i, h) { const env = this.env, bell = env.bell && env.bell.includes(h) && !this.role[i], G = this._cohort(i);
    const e = bell ? this._nearest(env.entrances.filter(q => q.door), this.x[i], this.z[i]) : this._nearest(this._exits(this.x[i], this.z[i], false), this.x[i], this.z[i]);
    G.forEach((j, f) => { this._release(j); this._endTalk(j); this.mode[j] = M.DEPART; this.act[j] = 17; this.pose[j] = 0; this.tgx[j] = e.x + (f % 2 ? 1 : -1) * Math.ceil(f / 2) * 1.4; this.tgz[j] = e.z; }); }
  _leave(i) { if (this.env.type === "hospital" && this.role[i] === 5) for (const b of this.beds) if (b.vis) { if (b.vis[0] === i) b.vis[0] = -1; if (b.vis[1] === i) b.vis[1] = -1; }
    this._release(i); this._endTalk(i); this.away[i] = 1; this.mode[i] = M.AWAY; this.pose[i] = 0; this.act[i] = 0; this.voc[i] = 0;
    if (this.env.bell) for (let j = 0; j < this.n; j++) if (this.leader[j] === i) { this.leader[j] = -1; if (!this.away[j] && this.mode[j] === M.FOLLOW) this.mode[j] = M.WANDER; } }
  _endTalk(i) { const j = this.partner[i]; if (j >= 0) { this.partner[j] = -1; if (this.mode[j] === M.CONVERSE) this.mode[j] = this.poiK[j] >= 0 ? M.MOVE : M.WANDER; } this.partner[i] = -1; }
  _queues() { // queues move up when the person at the front is done
    const pois = this._pois(); for (let p = 0; p < pois.length; p++) { const k = pois[p].kind; if (k !== "queue" && k !== "desk") continue; const o = this.occ[p];
      for (let s = 1; s < o.length; s++) if (o[s - 1] < 0 && o[s] >= 0) { const j = o[s]; o[s - 1] = j; o[s] = -1; this.slotK[j] = s - 1; const sl = pois[p].slots[s - 1]; this.tgx[j] = sl.x; this.tgz[j] = sl.z; if (this.mode[j] === M.DWELL) this.mode[j] = M.MOVE; } }
  }
  _arrived(i, h) { // reached the slot: settle in and note who is there
    const p = this.poiK[i], q = this._pois()[p], sl = q.slots[this.slotK[i]], k = q.kind;
    this.mode[i] = M.DWELL; this.pose[i] = sl.pose; this.yaw[i] = sl.yaw; this.x[i] = sl.x; this.z[i] = sl.z;
    this.act[i] = k === "stall" ? 1 : k === "cart" ? 13 : k === "table" ? 14 : k === "bench" ? (this.env.type === "hospital" ? 9 : this.foodBench[p] ? 23 : 2) : k === "queue" ? 4 : k === "desk" ? 10 : this.env.type === "hospital" ? 11 : 3;
    this.eat[i] = k === "cart" || k === "table" || (k === "bench" && this.foodBench[p] && this.env.type !== "hospital") ? 1 : 0;
    if (k === "stall" || k === "cart") this.bag[i] = k === "stall" ? 1 : this.bag[i];
    const v = q.vx != null ? this.vendorOf[p] : -1, mins = this.at[i] * 5;
    if (v >= 0 && !this.away[v]) this._log(i, v, k === "cart" ? "cart" : k === "desk" ? "desk" : "buy", p, 1.0, Math.max(2, Math.round(mins * 0.6)));
    const o = this.occ[p]; let c = 0;
    for (let s = 0; s < o.length && c < 4; s++) { const j = o[s]; if (j < 0 || j === i || this.mode[j] !== M.DWELL) continue; c++;
      if (k === "queue" || k === "desk") { if (Math.abs(s - this.slotK[i]) === 1) this._log(i, j, k === "desk" ? "waitroom" : "queue", p, 1.1, mins + 5); }
      else this._log(i, j, k === "bench" ? (this.eat[i] ? "food" : this.env.type === "hospital" ? "waitroom" : "sit") : k === "table" ? "table" : k === "cart" ? "cart" : k === "stall" ? "queue" : "chat", p, 1.0, mins); }
  }
  _subWalk(h, k) {
    const P = this.P, env = this.env, n = this.n, rnd = this.rnd, life = P.routines, tick = ++this.tick, cand = [];
    const add = i => { if (this.stamp[i] !== tick) { this.stamp[i] = tick; cand.push(i); } };
    for (const i of this.here) add(i); const A = this.arrQ.get(h * SUB + k); if (A) for (const i of A) add(i);
    if (k === 1) for (const i of this.vendors) add(i);
    if (!life && k === 1) for (let i = 0; i < n; i++) if (this.away[i] && this.role[i] !== 2 && !this.blocked(i)) add(i);
    this._joined = []; this._queues();
    for (const i of cand) {
      if (this.blocked(i)) { if (!this.away[i] || this.mode[i] !== M.AWAY) this._leave(i); continue; }
      const r = this.role[i];
      if (r === 2) { const p = this.home[i], q = env.pois[p], on = !life || (this.go[i] && h >= env.open[0] && h < env.open[1]);
        if (!on) { if (!this.away[i]) this._leave(i); continue; } this.away[i] = 0; this.visited[i] = 1; this.mode[i] = M.FIXED; this.x[i] = q.vx; this.z[i] = q.vz; this.yaw[i] = q.fz > 0 ? 0 : Math.PI; this.act[i] = 5; this.poiK[i] = p; continue; }
      if (this.away[i]) { if (life ? this.go[i] && this.leader[i] < 0 && h === this.arrive[i] && k === this.arrSub[i] && !this.visited[i] : this.go[i]) this._arrive(i, h); continue; }
      if (life && this.mode[i] !== M.DEPART && this.leader[i] < 0 && h >= this.leave[i] && k >= this.depSub[i]) this._depart(i, h);
      const m = this.mode[i], sp = this._speed(i);
      if (m === M.MOVE) { if (this._stepTo(i, this.tgx[i], this.tgz[i], sp)) this._arrived(i, h); }
      else if (m === M.DWELL) { const q = env.pois[this.poiK[i]]; if ((q.kind === "queue") && this.slotK[i] > 0) continue; if (--this.at[i] <= 0) { this._release(i); this._next(i, h, k); } }
      else if (m === M.CONVERSE) { const j = this.partner[i]; if (j >= 0) this.yaw[i] = Math.atan2(this.x[j] - this.x[i], this.z[j] - this.z[i]); if (--this.at[i] <= 0) { this.convEnd[i] = this.t * SUB + k; this._endTalk(i); this.mode[i] = this.poiK[i] >= 0 ? M.MOVE : M.WANDER; } }
      else if (m === M.WANDER) { if (this._stepTo(i, this.tgx[i], this.tgz[i], sp * 0.75)) { if (--this.wt[i] <= 0 && P.walkMode !== "free") this._next(i, h, k); else this._wander(i, 1); } }
      else if (m === M.FOLLOW) { const L = this.leader[i]; if (L < 0 || this.away[L]) { this.leader[i] = -1; this._wander(i); continue; }
        const f = this.fol[i], lat = f === 3 ? 0 : (f % 2 ? 1.3 : -1.3), back = f === 3 ? -1.6 : 0, a = this.yaw[L];
        this._stepTo(i, this.x[L] + lat * Math.cos(a) + back * Math.sin(a), this.z[L] - lat * Math.sin(a) + back * Math.cos(a), sp * 1.4); if (Math.hypot(this.x[L] - this.x[i], this.z[L] - this.z[i]) < 2.5) this.yaw[i] = this.yaw[L]; }
      else if (m === M.DEPART) { if (this._stepTo(i, this.tgx[i], this.tgz[i], sp)) { this._note(i, "left"); this._leave(i); } }
    }
    for (const j of this._joined) add(j); this.here = cand.filter(i => !this.away[i]);
    this._encounters(k);
  }
  _encounters(k) { // two strollers within 1.5 m may stop and talk, depending on who they are
    const rnd = this.rnd, cell = 3, now = this.t * SUB + k, S = [0.5, 1.6, 1, 1.2], L = [];
    for (const i of this.here) if (this.mode[i] === M.WANDER && this.leader[i] < 0 && now - this.convEnd[i] > 6) L.push(i);
    if (L.length < 2) return; this._gridBuild(L, this.x, this.z, cell, 1); const H = this.gHead, N = this.gNext;
    for (const i of L) { if (this.mode[i] !== M.WANDER) continue; const cx = Math.floor(this.x[i] / cell), cz = Math.floor(this.z[i] / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (let j = H[this._cell(cx + a, cz + b, this.zone[i])]; j >= 0; j = N[j]) { if (j <= i || this.mode[j] !== M.WANDER || this.mode[i] !== M.WANDER || this.zone[j] !== this.zone[i]) continue; const ddx = this.x[j] - this.x[i], ddz = this.z[j] - this.z[i], d = Math.sqrt(ddx * ddx + ddz * ddz); if (d > 2.5) continue;
          const p = 0.25 * S[this.persona[i]] * S[this.persona[j]] * (this.distancing(i) || this.distancing(j) ? 0.15 : 1); if (rnd() >= p) continue;
          const mx = (this.x[i] + this.x[j]) / 2, mz = (this.z[i] + this.z[j]) / 2, ux = (this.x[j] - this.x[i]) / (d || 1), uz = (this.z[j] - this.z[i]) / (d || 1), dur = 2 + Math.floor(rnd() * 5);
          for (const [q, sg] of [[i, -1], [j, 1]]) { this.mode[q] = M.CONVERSE; this.at[q] = dur; this.x[q] = mx + sg * ux * 0.85; this.z[q] = mz + sg * uz * 0.85; this.act[q] = 15; }
          this.partner[i] = j; this.partner[j] = i; this.yaw[i] = Math.atan2(ux, uz); this.yaw[j] = Math.atan2(-ux, -uz); this._log(i, j, "talk", -1, 1.0, dur * 5); } } }
  }
  _placeAll() { // everyone stays all day: put them in the scene at once
    const Z = this.env.zones[0], rnd = this.rnd;
    for (let i = 0; i < this.n; i++) { if (this.role[i] === 2) continue; this.away[i] = 0; this.visited[i] = 1; this.zone[i] = 0;
      let g = 0; do { this.x[i] = 2 + rnd() * (Z.W - 4); this.z[i] = 2 + rnd() * (Z.D - 4); } while (this._hit(0, this.x[i], this.z[i]) && g++ < 30); this._next(i, 0, 0); }
    this.here = []; for (let i = 0; i < this.n; i++) if (!this.away[i]) this.here.push(i);
  }
  /* ---------- guards at the entrance ---------- */
  _guardCheck(i) { // a guard at the entrance notices symptoms, sends the person for a rapid test, and hands a quarantine letter
    const P = this.P, rnd = this.rnd, G = GUARDS[P.guardType] || GUARDS.bhw, sym = this.symptomatic(i);
    const stop = sym ? rnd() < 1 - Math.pow(1 - P.guardNotice, P.guard) : rnd() < P.guardFalse * P.guard; if (!stop) return false;
    this.cost.stops++; this.trust = Math.max(15, this.trust - G.stop); const infected = this.state[i] === INFECTIOUS, pos = infected ? rnd() < P.guardAccuracy : rnd() < 0.03;
    this._note(i, "guard", { res: pos ? "pos" : "neg" }); this._ev.push({ type: "guard", i, sym, pos, infected });
    if (!pos) return false; if (P.guardDelay > 0) { this.guardAt[i] = this.t + P.guardDelay * P.stepsPerDay; return false; } return this._guardHome(i);
  }
  _guardHome(i) { const P = this.P, G = GUARDS[P.guardType] || GUARDS.bhw; if (this.blocked(i)) return false;
    if (this.rnd() >= P.guardComply * this.compliance()) { this._note(i, "ignored"); return false; }
    if (this.state[i] === INFECTIOUS) { if (!this.reported[i]) this._report(i, null, "guard"); this.isolated[i] = 1; this.cost.guardCaught++; this._trace(i); }
    else { this.quarantined[i] = 1; this.cost.falseAlarms++; this.trust = Math.max(15, this.trust - G.wrong); }
    this.qWhy[i] = 3; this.qDay[i] = this.day; this._leave(i); this.homeUntil[i] = this.t + P.guardDays * P.stepsPerDay; this._note(i, "senthome"); this._ev.push({ type: "guardhome", i, infected: this.state[i] === INFECTIOUS }); return true; }
  /* ---------- jeepney: 16 passengers on two facing benches, a driver and one passenger in front ---------- */
  loadAt(h) { if (!this.P.routines) return ((h % 24) + 24) % this.P.loads;   // round the clock: a load every hour, day and night
    const half = this.P.loads / 2; return h >= 5 && h < 5 + half ? h - 5 : h >= 16 && h < 16 + half ? half + h - 16 : -1; }
  _wants(k) { const o = []; for (let i = 1; i < this.n; i++) if ((this.am[i] === k || this.pm[i] === k) && this.go[i] && !this.blocked(i)) o.push(i); return o; }
  static seatPhys(s) { return s === 17 ? [0.0, -0.9, Math.PI] : s === 16 ? [0.55, -0.9, Math.PI] : s < 8 ? [0, 0.45 * s, Math.PI / 2] : [0.8, 0.45 * (s - 8), -Math.PI / 2]; }
  _boardJeep(h) { // a new load: riders take their seats, the next load queues at the stop, the fares go forward hand to hand
    const P = this.P, n = this.n, rnd = this.rnd; for (let i = 0; i < n; i++) { this.away[i] = 1; this.seat[i] = -1; this.mode[i] = M.AWAY; }
    const k = this.loadAt(h); this.riders = []; this.queue = []; this.fares = []; this.chatters = []; this.stuckFrom = 99; this.stuckTo = -1;
    if (k >= 0) { const skip = Math.round(8 * P.dist * this.compliance()), cap = 17 - skip, order = [];
      for (const b of [0, 8]) { const used = 8 - Math.ceil(skip / 2); for (let q = 0; q < used; q++) order.push(b + Math.min(7, Math.round(q * 7 / Math.max(1, used - 1)))); } order.push(16);
      let c = this.leftover.filter(i => !this.blocked(i)).concat(this._wants(k)); this.leftover = c.slice(cap); c = c.slice(0, cap).sort((a, b) => this.pref[a] - this.pref[b]); if (this.loadAt(h + 1) < 0) this.leftover = [];
      c.forEach((i, o) => { const s = skip ? order[o] : o; this.seat[i] = s; const front = s === 16, side = s < 8 ? -1 : 1, row = s % 8; this.away[i] = 0; this.visited[i] = 1; this.zone[i] = 0; this.pose[i] = 1; this.mode[i] = M.FIXED; this.act[i] = 19;
        this.x[i] = front ? 5.0 : 3.5 + side * 2.45; this.z[i] = front ? -2.6 : 3.0 + row * 2.6; this.yaw[i] = front ? Math.PI : side < 0 ? Math.PI / 2 : -Math.PI / 2; });
      const drv = !this.blocked(0) && this.go[0]; if (drv) { this.seat[0] = 17; this.away[0] = 0; this.visited[0] = 1; this.zone[0] = 0; this.pose[0] = 1; this.mode[0] = M.FIXED; this.act[0] = 19; this.x[0] = 2.0; this.z[0] = -2.6; this.yaw[0] = Math.PI; this.driver.loads++; let inf = 0; for (const i of c) if (this.contagious(i)) inf++; this.driver.carried += inf; if (inf) this.driver.exposedLoads++; }
      const R = drv ? c.concat([0]) : c; this.riders = R; const bySeat = {}; for (const i of R) bySeat[this.seat[i]] = i;
      for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) { const sa = this.seat[R[a]], sb = this.seat[R[b]]; let kind = null;
        if (sa < 16 && sb < 16) { const same = (sa < 8) === (sb < 8), dr = Math.abs(sa % 8 - sb % 8); kind = same ? (dr === 1 ? "beside" : dr === 2 ? "near" : null) : (dr === 0 ? "facing" : dr === 1 ? "near" : null); }
        else if (sa >= 16 && sb >= 16) kind = "beside";
        if (kind) this._log(R[a], R[b], kind, -1, kind === "beside" ? 0.45 : kind === "facing" ? 0.8 : 0.9, 45); }
      // fares: from each seat toward the front, hand to hand, then to the driver ("Bayad po")
      c.forEach((i, o) => { const s = this.seat[i], sub = 1 + (o % 3); if (s === 16) { if (drv) this.fares.push([sub, i, 0, i]); return; }
        let cur = i, row = s % 8; const base = s < 8 ? 0 : 8; while (row > 0) { const nx = bySeat[base + row - 1]; if (nx == null) break; this.fares.push([sub, cur, nx, i]); cur = nx; row--; }
        if (drv) this.fares.push([sub, cur, 0, i]); });
      for (const [, a, b] of this.fares) this._log(a, b, "fare", -1, 0.4, 1);
      for (const i of c) if (rnd() < 0.15) { const s = this.seat[i]; if (s >= 16) continue; const nb = bySeat[s % 8 < 7 ? s + 1 : s - 1]; if (nb != null && nb !== i) this.chatters.push([i, nb]); }
      if (rnd() < P.jeepTraffic) { this.stuckFrom = 2 + Math.floor(rnd() * 6); this.stuckTo = Math.min(11, this.stuckFrom + 2 + Math.floor(rnd() * 5)); }
    }
    const k2 = this.loadAt(h + 1); if (k2 >= 0) { const w = this._wants(k2).filter(i => this.seat[i] < 0); this.queue = w;
      w.forEach((i, q) => { const col = Math.floor(q / 2), row = q % 2; this.away[i] = 0; this.visited[i] = 1; this.zone[i] = 1; this.pose[i] = 0; this.mode[i] = M.FIXED; this.act[i] = 20; this.x[i] = 90 - col * 1.9; this.z[i] = 21.8 - row * 2.1; this.yaw[i] = Math.PI / 2; if (q > 1) this._log(w[q - 2], i, "wait", -1, 1.1, 15); }); }
  }
  jeepMoving(k) { return !(k >= this.stuckFrom && k <= this.stuckTo); }
  _subJeep(h, k) { // riders get off after 45 minutes ("Para po"); the next load starts queuing at the stop
    if (k === 10) for (const i of this.riders) { this.away[i] = 1; this.mode[i] = M.AWAY; this.pose[i] = 0; }
    for (const i of this.queue) { const on = k >= 9; this.away[i] = on ? 0 : 1; this.mode[i] = on ? M.FIXED : M.AWAY; }
    this.here = []; for (let i = 0; i < this.n; i++) if (!this.away[i] && !this.blocked(i)) this.here.push(i); }
  jeepACH(k) { const P = this.P, mv = this.jeepMoving(k); return (P.windowsOpen ? (mv ? 35 : 8) : (mv ? 6 : 2.5)) * P.achScale; }
  /* ---------- hospital: staff rounds, patients in beds, visitors at the bedside, outpatients register then wait outside ---------- */
  _bedSlot(b, who) { const s = b.zone === 1 ? 1 : b.z < 4 ? 1 : -1; return who === "staff" ? [b.x - 2.4, b.z + s * 1.2] : who === 0 ? [b.x + 2.3, b.z + s * 1.5] : [b.x + 3.2, b.z + s * 2.4]; }
  _subHosp(h, k) {
    const P = this.P, n = this.n, rnd = this.rnd, env = this.env, pois = env.ypois, open = env.open, life = P.routines, yd = env.yardDoor, wardDoor = env.entrances[0];
    this._queues();
    for (let i = 0; i < n; i++) {
      const r = this.role[i];
      if (this.bed[i] >= 0) { const b = this.beds[this.bed[i]]; this.away[i] = 0; this.mode[i] = M.FIXED; this.zone[i] = b.zone; this.x[i] = b.x; this.z[i] = b.z; this.yaw[i] = b.yaw; this.pose[i] = 2; continue; }
      if (this.blocked(i)) { if (!this.away[i] || this.mode[i] !== M.AWAY) this._leave(i); continue; }
      if (r >= 1 && r <= 3) { const on = !life || (this.go[i] && (this.shift[i] === 0 ? h >= 7 && h < 19 : h >= 19 || h < 7));
        if (!on) { if (!this.away[i]) this._leave(i); continue; }
        if (this.away[i]) { this.away[i] = 0; this.visited[i] = 1; this.pose[i] = 0; this.at[i] = 0;
          const yardBeds = this.beds.some(b => b.zone === 1 && b.by >= 0); this.zone[i] = r === 3 ? (this.sub[i] === 1 || this.sub[i] === 2 ? 0 : 1) : yardBeds && i % 3 === 0 ? 1 : 0;
          if (this.zone[i] === 0) { this.x[i] = wardDoor.x; this.z[i] = wardDoor.z; } else { this.x[i] = yd.x; this.z[i] = yd.z; } this.mode[i] = M.WANDER; this.tgx[i] = this.x[i]; this.tgz[i] = this.z[i]; }
        if (r === 3 && this.sub[i] !== 1) { const rec = this.sub[i] === 2, q = pois[0]; this.mode[i] = M.FIXED; this.zone[i] = rec ? 0 : 1; this.x[i] = rec ? q.vx : 6 + (i % 2) * 100; this.z[i] = rec ? q.vz : 44; this.yaw[i] = rec ? Math.PI : 0; this.act[i] = 7; continue; }
        if (r === 3) { this.act[i] = 24; if (this._stepTo(i, this.tgx[i], this.tgz[i], this._speed(i) * 0.6)) { this.tgx[i] = 4 + rnd() * 76; this.tgz[i] = -10 + rnd() * 30; } continue; }
        // doctors and nurses: walk to a bed, check the patient, move on; one check in seven is a long procedure
        if (this.mode[i] === M.DWELL) { this.act[i] = this.at[i] > 3 ? 21 : 22; if (--this.at[i] <= 0) { this.mode[i] = M.WANDER; this.breach[i] = 0; } continue; }
        if (this.mode[i] === M.MOVE) { if (this._stepTo(i, this.tgx[i], this.tgz[i], this._speed(i))) { const b = this.beds[this.poiK[i]]; this.mode[i] = M.DWELL; this.yaw[i] = Math.atan2(b.x - this.x[i], b.z - this.z[i]);
            const long = rnd() < 0.15; this.at[i] = long ? 6 + Math.floor(rnd() * 5) : 2; this.breach[i] = rnd() < P.ppeBreach ? 1 : 0; if (b.by >= 0) this._log(i, b.by, long ? "procedure" : "check", -1, 0.6, this.at[i] * 5); if (this.breach[i]) this._ev.push({ type: "breach", i, p: b.by, s: k }); } continue; }
        const mine = this.beds.map((b, q) => [b, q]).filter(([b]) => b.by >= 0 && b.zone === this.zone[i]);
        if (mine.length) { const [b, q] = mine[Math.floor(rnd() * mine.length)], [sx, sz] = this._bedSlot(b, "staff"); this.poiK[i] = q; this.tgx[i] = sx; this.tgz[i] = sz; this.mode[i] = M.MOVE; this.act[i] = 6; }
        else { this.act[i] = 6; this._stepTo(i, this.zone[i] ? 30 + rnd() * 50 : 70, this.zone[i] ? 20 : 2, this._speed(i)); }
        continue; }
      if (r === 4) continue;
      // visitors and outpatients
      const on = !life || (this.go[i] && h >= this.arrive[i] && h < this.leave[i] + 1);
      if (this.away[i]) { if (!on || (life && !(h === this.arrive[i] && k === this.arrSub[i])) || this.visited[i]) continue;
        if (r === 5) { const pt = this.visits[i], b = this.bed[pt] >= 0 ? this.beds[this.bed[pt]] : null; if (!b) continue; const v = b.vis || (b.vis = [-1, -1]), s = v[0] < 0 ? 0 : v[1] < 0 ? 1 : -1; if (s < 0) continue;
          v[s] = i; this.away[i] = 0; this.visited[i] = 1; this.zone[i] = b.zone; const e = b.zone === 0 ? wardDoor : this._nearest(this._exits(b.x, b.z, false), b.x, b.z); this.x[i] = e.x; this.z[i] = e.z;
          const [sx, sz] = this._bedSlot(b, s); this.tgx[i] = sx; this.tgz[i] = sz; this.mode[i] = M.MOVE; this.act[i] = 8; this.at[i] = 6 + Math.floor(rnd() * 5); this.poiK[i] = -1; this.slotK[i] = s; this._note(i, "arrived"); continue; }
        this.away[i] = 0; this.visited[i] = 1; this.zone[i] = 0; this.x[i] = wardDoor.x; this.z[i] = wardDoor.z + (rnd() - 0.5) * 3; this._note(i, "arrived");
        this._goTo(i, 0); if (this.poiK[i] < 0) { this.zone[i] = 1; this.x[i] = yd.x; this.z[i] = yd.z; this._wander(i); } continue; }
      if ((life || r === 5) && this.mode[i] !== M.DEPART && h >= this.leave[i] && k >= this.depSub[i]) { this._release(i); this._endTalk(i);
        if (this.zone[i] === 0) { this.tgx[i] = wardDoor.x; this.tgz[i] = wardDoor.z; } else { const e = this._nearest(this._exits(this.x[i], this.z[i], false), this.x[i], this.z[i]); this.tgx[i] = e.x; this.tgz[i] = e.z; }
        this.mode[i] = M.DEPART; this.act[i] = 17; this.pose[i] = 0; }
      const m = this.mode[i], sp = this._speed(i);
      if (r === 5 && m !== M.DEPART) { if (m === M.MOVE) { if (this._stepTo(i, this.tgx[i], this.tgz[i], sp)) { const pt = this.visits[i]; this.mode[i] = M.DWELL; this.yaw[i] = Math.atan2(this.x[pt] - this.x[i], this.z[pt] - this.z[i]); this._log(i, pt, "bedside", -1, 1.0, this.at[i] * 5); } }
        else if (m === M.DWELL && --this.at[i] <= 0) { this.leave[i] = h; this.depSub[i] = k; } continue; }
      if (m === M.MOVE) { if (this._stepTo(i, this.tgx[i], this.tgz[i], sp)) { if (this.toYard[i]) { this.toYard[i] = 0; this.zone[i] = 1; this.x[i] = yd.x; this.z[i] = yd.z; this._next(i, h, k); } else if (this.poiK[i] >= 0) this._arrived(i, h); else this._wander(i); } }
      else if (m === M.DWELL) { const q = pois[this.poiK[i]]; if (q.kind === "desk" && this.slotK[i] > 0) continue;
        if (--this.at[i] <= 0) { const desk = q.kind === "desk"; this._release(i); if (desk) { this.mode[i] = M.MOVE; this.toYard[i] = 1; this.tgx[i] = wardDoor.x; this.tgz[i] = wardDoor.z; this.act[i] = 12; } else this._next(i, h, k); } }
      else if (m === M.CONVERSE) { const j = this.partner[i]; if (j >= 0) this.yaw[i] = Math.atan2(this.x[j] - this.x[i], this.z[j] - this.z[i]); if (--this.at[i] <= 0) { this.convEnd[i] = this.t * SUB + k; this._endTalk(i); this.mode[i] = M.WANDER; } }
      else if (m === M.WANDER) { this.pose[i] = this.wheel[i] ? 1 : 0; if (this._stepTo(i, this.tgx[i], this.tgz[i], sp * 0.7)) { if (--this.wt[i] <= 0) this._next(i, h, k); else this._wander(i, 1); } }
      else if (m === M.DEPART) { if (this._stepTo(i, this.tgx[i], this.tgz[i], sp)) { if (r === 5 && this.slotK[i] >= 0) { const pt = this.visits[i], b = this.bed[pt] >= 0 ? this.beds[this.bed[pt]] : null; if (b && b.vis) b.vis[this.slotK[i]] = -1; this.slotK[i] = -1; } this._note(i, "left"); this._leave(i); } }
      if (this.wheel[i] && !this.away[i]) this.pose[i] = 1;
    }
    this.here = []; for (let i = 0; i < n; i++) if (!this.away[i]) this.here.push(i);
    this._encounters(k);
  }
  _gridBuild(list, X, Z, cell, scale) { const H = this.gHead, N = this.gNext; for (const c of this.gUsed) H[c] = -1; this.gUsed.length = 0;
    for (const i of list) { const c = this._cell(Math.floor(X[i] * scale / cell), Math.floor(Z[i] * scale / cell), this.zone[i]); if (H[c] < 0) this.gUsed.push(c); N[i] = H[c]; H[c] = i; } }
  _cell(cx, cz, zo) { return ((cx & 127) | ((cz & 63) << 7) | ((zo & 1) << 13)); }
  /* ======================================================================================================
     Voices. Each sub-step decides who is breathing quietly, who is talking (and to whom), and who shouts.
     ====================================================================================================== */
  _talk(i, j, dur) { this.voc[i] = 1; this.say[i] = j; this.vdur[i] = dur || 1; this._spoke.push(i); }   // dur: share of the 5 minutes spent speaking
  _voices(h, k) {
    const n = this.n, rnd = this.rnd, env = this.env, pois = this._pois(), H = this.here;
    for (const i of this._spoke || []) { this.voc[i] = 0; this.say[i] = -1; this.vdur[i] = 1; } this._spoke = [];
    if (env.type === "jeep") {
      for (const [s, a, b, who] of this.fares || []) if (s === k) { this._talk(a, b, 3 / 300); if (this.log) this.kev[k].say.push([a, a === who ? "Bayad po" : "Bayad daw"]); }
      for (const [a, b] of this.chatters || []) if (!this.voc[a] && !this.voc[b] && rnd() < 0.6) rnd() < 0.5 ? this._talk(a, b) : this._talk(b, a);
      if (k === 9) for (const i of this.riders) if (i !== 0 && rnd() < 0.3) { this._talk(i, 0, 2 / 300); if (this.log && this.kev[k].say.length < 5) this.kev[k].say.push([i, "Para po"]); }
      for (let q = 0; q < this.queue.length; q++) if (rnd() < 0.08) this._talk(this.queue[q], this.queue[q ^ 1] ?? this.queue[q]);
      return; }
    // places: one or two speakers per group, vendors shout and bargain
    const members = pois.map(() => []);
    for (const i of H) if (this.mode[i] === M.DWELL && this.poiK[i] >= 0 && this.slotK[i] >= 0) members[this.poiK[i]].push(i);
    for (let p = 0; p < pois.length; p++) { const q = pois[p], G = members[p], v = env.type === "walk" ? this.vendorOf[p] : -1;
      if (v >= 0 && !this.away[v]) { const u = rnd(); if (G.length) { if (u < 0.5) this._talk(v, G[Math.floor(rnd() * G.length)]); else if (u < 0.5 + (env.shout || 0.2) * 0.6) { this.voc[v] = 2; this.say[v] = -1; this.vdur[v] = 0.3; this._spoke.push(v); } }
        else if (u < (env.shout || 0.12)) { this.voc[v] = 2; this.say[v] = -1; this.vdur[v] = 0.3; this._spoke.push(v); }
        if (this.voc[v] === 2 && this.log && rnd() < 0.15) this.kev[k].say.push([v, ["Suki! Bili na!", "Bagong isda!", "Mura lang po!", "Tara, suki!"][Math.floor(rnd() * 4)]]);
        for (const i of G) if (rnd() < 0.25) this._talk(i, v); }
      if (q.kind === "queue" || q.kind === "desk") { for (const i of G) if (rnd() < 0.1) { const o = G.filter(j => j !== i); if (o.length) this._talk(i, o[Math.floor(rnd() * o.length)]); } continue; }
      if (G.length < 2) continue; const sp = G.length >= 4 ? 2 : 1, tk = env.talk || 0.6;
      for (let s = 0; s < sp; s++) if (rnd() < tk) { const a = G[Math.floor(rnd() * G.length)]; if (this.voc[a]) continue; const o = G.filter(j => j !== a); this._talk(a, o[Math.floor(rnd() * o.length)]); }
    }
    for (const i of H) { const m = this.mode[i];
      if (m === M.CONVERSE) { const j = this.partner[i]; if (j > i && rnd() < 0.85) rnd() < 0.5 ? this._talk(i, j) : this._talk(j, i); }
      else if (m === M.FOLLOW && rnd() < 0.2) { this._talk(i, this.leader[i]); }
      else if (env.type === "hospital") { const r = this.role[i];
        if ((r === 1 || r === 2) && m === M.DWELL && this.poiK[i] >= 0 && rnd() < 0.4) { const b = this.beds[this.poiK[i]]; if (b.by >= 0) this._talk(i, b.by); }
        else if (r === 5 && m === M.DWELL && rnd() < 0.5) this._talk(i, this.visits[i]);
        else if (r === 4 && rnd() < 0.15) { for (const j of H) if (this.visits[j] === i && this.mode[j] === M.DWELL) { this._talk(i, j); break; } } }
    }
    if (env.type === "hospital") { const desk = this.occ[0], rc = this.vendorOf[0]; if (rc >= 0 && !this.away[rc] && desk[0] >= 0 && rnd() < 0.5) this._talk(rc, desk[0]); }
  }
  /* ======================================================================================================
     Air. Far field per room, near field from each infectious person's jet, dose for everyone else.
     ====================================================================================================== */
  _physPos(i) { // position in metres; jeep seats use their real spacing (benches 0.8 m apart, seats 0.45 m)
    const e = this.env; if (e.type === "jeep" && this.zone[i] === 0 && this.seat[i] >= 0) { const s = Sim.seatPhys(this.seat[i]); this.mx[i] = s[0]; this.mz[i] = s[1]; return; }
    if (this.role[i] === 2 && e.type === "walk") { const q = e.pois[this.home[i]]; this.mx[i] = q.phx * 0.6; this.mz[i] = q.phz * 0.6; return; }
    if (e.type === "hospital" && this.role[i] === 3 && this.sub[i] === 2) { const q = e.ypois[0]; this.mx[i] = q.x * 0.6; this.mz[i] = (q.z + 1.6) * 0.6; return; }
    this.mx[i] = this.x[i] * 0.6; this.mz[i] = this.z[i] * 0.6; }
  _facing(i) { const j = this.say[i]; if (this.voc[i] && j >= 0 && j !== i) return Math.atan2(this.mx[j] - this.mx[i], this.mz[j] - this.mz[i]); if (this.env.type === "jeep" && this.seat[i] >= 0) return Sim.seatPhys(this.seat[i])[2]; return this.yaw[i]; }
  _roomOf(i) { const R = this.rooms; for (let r = 0; r < R.length; r++) { const q = R[r]; if (q.zone === this.zone[i] && this.x[i] >= q.x0 && this.x[i] <= q.x1 && this.z[i] >= q.z0 && this.z[i] <= q.z1) return r; } return -1; }
  _filt(i, near, out) { const P = this.P; // share of virus a person's face covering lets through
    if (this.ppe[i]) return !out && this.breach[i] ? 0.5 : 1 - P.ppe;
    if (this.eat[i]) return 1;
    let f = this.mH[i] ? 1 - (out ? P.maskSource : P.maskWearer) : 1; if (near && this.shH[i]) f *= 1 - (out ? P.shieldSource : P.shieldWearer); return f; }
  _hourly() { this.hStamp = (this.hStamp || 0) + 1; }
  _cache(i) { if (this.hs[i] === this.hStamp) return; this.hs[i] = this.hStamp; const s = this.state[i]; this.dH[i] = this.distancing(i) ? 1 : 0; this.mH[i] = this.masked(i) ? 1 : 0; this.shH[i] = this.shielded(i) ? 1 : 0; this.susH[i] = s === HEALTHY || s === RECOVERED ? this.susceptibility(i) : 0; }
  _air(h, k) {
    const P = this.P, env = this.env, rnd = this.rnd, bm = this.bm, R = this.rooms, here = this.here, em = [];
    for (const i of here) { this._cache(i); this._physPos(i); this.room[i] = this._roomOf(i); }
    // emission
    for (const r of R) { r.E = 0; r.src = []; r.ach = (r.cabin ? this.jeepACH(k) : r.ach0 * P.achScale); }
    for (const i of here) { if (!this.contagious(i)) continue; const sev = this.state[i] === SEVERE, mult = P.beta * P.qScale * bm * (this.silent[i] ? P.silentInfectivity : 1) * (sev ? 2 : 1);
      const vd = this.voc[i] ? this.vdur[i] : 1, q = (Q[this.voc[i]] * vd + Q[0] * (1 - vd)) * mult, rate = sev ? 3 * P.coughRate : this.symptomatic(i) ? P.coughRate : 0, cough = rate > 0 && rnd() < Math.min(0.9, rate * DT);
      const ef = this._filt(i, false, true), en = this._filt(i, true, true); em.push([i, q, cough ? COUGH_Q * mult / DT : 0, en]);
      if (this.room[i] >= 0) { const r = R[this.room[i]], e = (q + (cough ? COUGH_Q * mult / DT : 0)) * ef; r.E += e; r.src.push([i, e]); }
      if (cough && this.log) this.kev[k].cough.push(i); }
    for (const r of R) { const kk = r.ach + DECAY, Css = r.E / (r.V * kk), ex = Math.exp(-kk * DT); r.Cavg = Css + (r.C - Css) * (1 - ex) / (kk * DT); r.C = Css + (r.C - Css) * ex; }
    if (this.log) R.forEach((r, q) => this.kC[k * R.length + q] = r.Cavg);
    // near field: receptors in reach of each emitter's jet
    const near = this.nearAcc, touched = []; let cs = this.cS, cw = this.cW, cd = this.cD, cnt = 0;
    if (em.length) { const cell = 3; this._gridBuild(here, this.mx, this.mz, cell, 1); const GH = this.gHead, GN = this.gNext;
      for (const [i, q, qc, en] of em) { const fy = this._facing(i), fx = Math.sin(fy), fz = Math.cos(fy), voc = this.voc[i], reach = Math.max(NEAR_R[voc], qc ? COUGH_R : 0), cone = CONE[voc];
        const out = this.room[i] < 0, wind = out && env.phys.wind, Kd = P.nearK * (env.kf || 1) * (out ? 1 + 0.5 * (wind ? this.windSpd : 0) : R[this.room[i]].hepa ? 1.5 : 1);
        const movI = Math.hypot(this.x[i] - this.sx0[i], this.z[i] - this.sz0[i]) > 0.3, cx = Math.floor(this.mx[i] / cell), cz = Math.floor(this.mz[i] / cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          for (let j = GH[this._cell(cx + a, cz + b, this.zone[i])]; j >= 0; j = GN[j]) { if (j === i || this.zone[j] !== this.zone[i]) continue; const sj = this.state[j]; if ((sj !== HEALTHY && sj !== RECOVERED) || this.pend.has(j)) continue;
            let dx = this.mx[j] - this.mx[i], dz = this.mz[j] - this.mz[i], d = Math.hypot(dx, dz), eff = 1;
            if (Math.hypot((this.x[i] - this.sx0[i]) - (this.x[j] - this.sx0[j]), (this.z[i] - this.sz0[i]) - (this.z[j] - this.sz0[j])) > 1.0) { // walking past each other
              const rx = (this.sx0[j] - this.sx0[i]) * 0.6, rz = (this.sz0[j] - this.sz0[i]) * 0.6, vx = dx - rx, vz = dz - rz, vv = vx * vx + vz * vz, t = vv > 0 ? Math.max(0, Math.min(1, -(rx * vx + rz * vz) / vv)) : 1;
              dx = rx + vx * t; dz = rz + vz * t; d = Math.hypot(dx, dz); eff = PASS_S / 300; if (d < 1.0 && this.log && this.kev[k].pass.length < 30) this.kev[k].pass.push([i, j]); }
            if (eff === 1 && (this.dH[i] || this.dH[j]) && this.pose[i] !== 2 && !(env.type === "jeep" && this.zone[i] === 0)) { const g = 1 + d; dx *= g / (d || 1); dz *= g / (d || 1); d = g; }
            if (d > reach) continue; const dd = Math.max(0.3, d), cosA = (dx * fx + dz * fz) / (d || 1), ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
            let w = ang <= cone && d <= NEAR_R[voc] ? Math.cos(ang) * q : 0; if (qc && ang <= COUGH_CONE && d <= COUGH_R) w += Math.cos(ang) * qc; if (w <= 0) continue;
            if (wind) { const wa = Math.cos(Math.atan2(dx, dz) - this.windDir); w *= Math.max(0.3, 1 + 0.5 * wa); }
            const c = w * en / (4 * Math.PI * dd * dd * Kd) * eff; if (near[j] === 0) touched.push(j); near[j] += c;
            if (cnt >= cs.length) { this.cS = cs = Int32Array.from({ length: cs.length * 2 }, (_, x) => cs[x] || 0); this.cW = cw = Float64Array.from({ length: cs.length }, (_, x) => cw[x] || 0); this.cD = cd = Float32Array.from({ length: cs.length }, (_, x) => cd[x] || 0); this.cN = Int32Array.from({ length: cs.length }, (_, x) => this.cN[x] || 0); }
            cs[cnt] = i; cw[cnt] = c; cd[cnt] = eff < 1 ? -d : d; this.cN[cnt] = this.cH[j]; this.cH[j] = cnt; cnt++;
            if (this.log && this.kev[k].near.length < 80 && c > 0.002) this.kev[k].near.push([i, j, c, eff < 1 ? 1 : 0]); } } } }
    // fares passed hand to hand: two heads 0.4 m apart, facing, for about 10 seconds
    if (env.type === "jeep") for (const [s, a, b] of this.fares || []) { if (s !== k) continue; for (const [x, y, vq] of [[a, b, Q[1]], [b, a, Q[0]]]) { if (!this.contagious(x) || this.state[y] !== HEALTHY && this.state[y] !== RECOVERED || this.pend.has(y)) continue;
      const mult = P.beta * P.qScale * bm * (this.silent[x] ? P.silentInfectivity : 1), c = vq * mult * this._filt(x, true, true) / (4 * Math.PI * 0.16 * P.nearK * (env.kf || 1)) * (10 / 300); if (near[y] === 0) touched.push(y); near[y] += c;
      if (cnt >= cs.length) break; cs[cnt] = x; cw[cnt] = c; cd[cnt] = 0.4; this.cN[cnt] = this.cH[y]; this.cH[y] = cnt; cnt++; } }
    // dose
    for (const j of here) { const sus = this.susH[j]; if (sus <= 0.02 || this.pend.has(j)) continue; const sj = this.state[j]; if (sj !== HEALTHY && sj !== RECOVERED) continue;
      const room = this.room[j], cf = room >= 0 ? R[room].Cavg * this._filt(j, false, false) : 0, cn = near[j] * this._filt(j, true, false), dD = BREATH * DT * sus * (cf + cn);
      if (dD <= 0) continue; this.dose[j] += dD; this.doseDay[j] += dD; if (bm > 0) this.pressure += dD / bm;
      if (this.dose[j] >= this.thr[j]) { // infected: whose air was it? weighted by each source's share of this dose
        const fN = this._filt(j, true, false); let tot = cf, pick = -1, route = "air", dist = 0; for (let c = this.cH[j]; c >= 0; c = this.cN[c]) tot += cw[c] * fN;
        let u = rnd() * tot; for (let c = this.cH[j]; c >= 0; c = this.cN[c]) { if ((u -= cw[c] * fN) <= 0) { pick = cs[c]; route = cd[c] < 0 ? "pass" : "near"; dist = Math.abs(cd[c]); break; } }
        if (pick < 0 && room >= 0 && R[room].src.length) { let t2 = 0; for (const [, e] of R[room].src) t2 += e; let v = rnd() * t2; for (const [s, e] of R[room].src) { if ((v -= e) <= 0) { pick = s; break; } } if (pick < 0) pick = R[room].src[0][0]; }
        if (pick < 0) continue;
        const how = this._howFor(pick, j, route, dist, h, k); this.pend.set(j, [pick, how]); if (this.log) this.kev[k].inf.push([pick, j]); } }
    for (const j of touched) near[j] = 0; for (const j of here) this.cH[j] = -1;
  }
  _howFor(a, b, route, d, h, k) { // describe how b caught it from a, linking the logged interaction if there is one
    let it = null; if (this.log) for (let q = this.diary[b].length - 1; q >= 0; q--) { const e = this.diary[b][q]; if (!e.note && (e.a === a || e.b === a)) { it = e; break; } }
    const room = this.room[b] >= 0 ? this.rooms[this.room[b]].name : null;
    const kind = route === "air" ? "air" : route === "pass" ? "pass" : this._kindFor(a, b, it);
    const rec = Object.assign({}, it || {}, { t: this.t, s: k, a, b, k: kind, r: route, d: route === "air" ? null : +(d || (it && it.d) || 1).toFixed(1), m: it ? it.m : route === "pass" ? 0 : 5, p: it ? it.p : this.poiK[b], room, voc: this.voc[a], inf: 1 });
    if (it) it.inf = 1; if (this.log) { this.inter.push(rec); this.contacts.push(rec); } return rec;
  }
  _kindFor(a, b, it) { // what the two were doing when the virus passed, from their current activities
    const e = this.env, pois = this._pois(), pa = this.poiK[a], pb = this.poiK[b];
    if (e.type === "jeep") { const sa = this.seat[a], sb = this.seat[b]; if (this.fares && this.fares.some(f => f[0] === this._k && ((f[1] === a && f[2] === b) || (f[1] === b && f[2] === a)))) return "fare";
      if (sa < 0 || sb < 0) return this.zone[a] === 1 ? "wait" : "chat"; if (sa >= 16 || sb >= 16) return sa >= 16 && sb >= 16 ? "beside" : "near"; const same = (sa < 8) === (sb < 8), dr = Math.abs(sa % 8 - sb % 8); return same ? (dr === 1 ? "beside" : "near") : dr === 0 ? "facing" : "near"; }
    if (e.type === "hospital") { const ra = this.role[a], rb = this.role[b], staff = r => r === 1 || r === 2; if (staff(ra) && this.bed[b] >= 0 || staff(rb) && this.bed[a] >= 0) return (this.at[staff(ra) ? a : b] > 3 ? "procedure" : "check"); if (ra === 5 && this.bed[b] >= 0 || rb === 5 && this.bed[a] >= 0) return "bedside"; if (staff(ra) && staff(rb)) return "handover"; }
    if (this.voc[a] === 2) return "shout"; if (this.mode[a] === M.CONVERSE || this.mode[b] === M.CONVERSE) return "talk"; if (this.mode[a] === M.FOLLOW || this.mode[b] === M.FOLLOW) return "cohort";
    const q = pb >= 0 && this.slotK[b] >= 0 ? pois[pb] : pa >= 0 && this.slotK[a] >= 0 ? pois[pa] : this.role[a] === 2 && e.type === "walk" ? e.pois[this.home[a]] : null;
    if (q) { const k = q.kind; return k === "stall" ? (this.role[a] === 2 || this.role[b] === 2 ? "buy" : "queue") : k === "cart" ? "cart" : k === "bench" ? (e.type === "hospital" ? "waitroom" : this.eat[b] || this.eat[a] ? "food" : "sit") : k === "table" ? "table" : k === "queue" ? "queue" : k === "desk" ? "desk" : "chat"; }
    return it ? it.k : "chat"; }
  _log(a, b, kind, poi, d, m) { // an interaction: who, doing what, how close (m) and for how long (min)
    if (!this.log) return; const it = { t: this.t, s: this._k || 0, a, b, k: kind, d, m, p: poi, inf: 0 }; this.diary[a].push(it); this.diary[b].push(it); this.inter.push(it); this.contacts.push(it); }
  _note(i, k, extra) { if (this.log) this.diary[i].push(Object.assign({ t: this.t, s: this._k || 0, k, note: 1 }, extra || {})); }
  _key(k) { if (!this.log) return; const n = this.n, o = k * n, K = this.K; for (let i = 0; i < n; i++) { K.x[o + i] = this.x[i]; K.z[o + i] = this.z[i]; K.yaw[o + i] = this.yaw[i]; K.vis[o + i] = this.away[i] ? 0 : 1; K.pose[o + i] = this.pose[i]; K.voc[o + i] = this.voc[i]; K.say[o + i] = this.say[i]; K.zone[o + i] = this.zone[i]; K.dose[o + i] = this.doseDay[i]; K.act[o + i] = this.act[i]; } }
  /* ---------- one hour: 12 sub-steps of movement, voices and air, then the disease clock ---------- */
  step() {
    const P = this.P, n = this.n, st = this.state, env = this.env, spd = P.stepsPerDay, ev = this._ev = [], h = this.t % spd, day = Math.floor(this.day);
    this.pend = new Map(); this.contacts.length = 0;
    this.bm = P.track ? this.curMult : P.betaSchedule ? (P.betaSchedule[Math.min(day, P.betaSchedule.length - 1)] ?? 1) : 1;
    if (h === 0) { if (P.track || P.importSchedule) this._startDay(day); this.bm = P.track ? this.curMult : this.bm; this._planDay(); }
    if (this.log) { this.kev = Array.from({ length: SUB + 1 }, () => ({ cough: [], near: [], pass: [], say: [], inf: [], breach: [] })); this._k = 0; }
    if (env.bell && env.bell.includes(h) && P.routines) ev.push({ type: "bell", s: 0 });
    this._hourly();
    if (env.type === "jeep") this._boardJeep(h);
    this._key(0);
    const quiet = env.type === "walk" && P.routines && !this.here.length && (h < env.open[0] - 1 || h >= env.open[1]);
    if (quiet) { for (const r of this.rooms) { r.C *= Math.exp(-(r.ach0 * P.achScale + DECAY)); r.Cavg = r.C; } if (this.log) for (let k = 1; k <= SUB; k++) this._key(k); }
    else for (let k = 1; k <= SUB; k++) { this._k = k;
      for (const i of this.here) { this.sx0[i] = this.x[i]; this.sz0[i] = this.z[i]; } for (const i of this._joinedPrev || []) { this.sx0[i] = this.x[i]; this.sz0[i] = this.z[i]; }
      if (env.type === "walk") this._subWalk(h, k); else if (env.type === "hospital") this._subHosp(h, k); else this._subJeep(h, k);
      this._voices(h, k); this._air(h, k); this._key(k); }
    for (const e of ev) if (e.type === "breach" && this.log) this.kev[e.s].breach.push([e.i, e.p]);
    // disease progression
    for (let i = 0; i < n; i++) {
      const s = st[i]; if (s === HEALTHY || s === RECOVERED || s === DECEASED) continue;
      this.timer[i]--;
      if (s === EXPOSED) { if (this.timer[i] <= 0) { st[i] = INFECTIOUS; this.timer[i] = this.mildSteps[i]; this.tInfectious[i] = 0; this.infectiousDay[i] = this.day; } }
      else if (s === INFECTIOUS) { this.tInfectious[i]++;
        if (this.timer[i] <= 0) { if (this.fateSevere[i]) this._becomeSevere(i, ev); else this._recover(i, ev); } }
      else if (s === SEVERE && this.timer[i] <= 0) {
        const b = this.bed[i], risk = b < 0 ? (this.noBed[i] ? P.noBedRisk : 1) : this.beds[b].overflow ? P.overflowRisk : 1;
        const pDie = Math.min(0.95, P_DIE_IF_SEVERE[this.ageGroup[i]] * P.fatality * risk);
        if (this.frailty[i] < pDie) this._die(i, ev); else this._recover(i, ev);
      }
    }
    // new exposures, each linked to the air it came from
    for (const [b, [a, it]] of this.pend) { this._infect(b, a, false, it); ev.push({ type: "infect", a, b, how: it, s: it.s || 0 }); }
    // reporting, isolation, tracing, guard letters
    for (let i = 0; i < n; i++) {
      if (this.t >= this.homeUntil[i]) { this.homeUntil[i] = Infinity; if (this.qWhy[i] === 3) { this.isolated[i] = 0; this.quarantined[i] = 0; } }
      if (this.t >= this.guardAt[i]) { this.guardAt[i] = Infinity; this._guardHome(i); }
      if (this.t >= this.testAt[i]) this._testResult(i);
      const s = st[i]; if (s !== EXPOSED && s !== INFECTIOUS && s !== SEVERE) continue;
      if (!this.reported[i] && this.t >= this.reportAt[i] && s !== EXPOSED) this._report(i, ev, "test");
      if (!this.isolated[i] && s === INFECTIOUS && this.reported[i] && this.willIsolate(i) && this.t >= this.isoAt[i]) { this.isolated[i] = 1; if (!this.qWhy[i]) { this.qWhy[i] = 1; this.qDay[i] = this.day; } ev.push({ type: "isolate", i }); this._trace(i); }
      if (!this.quarantined[i] && !this.isolated[i] && this.t >= this.traceAt[i]) { this.quarantined[i] = 1; this.revealed[i] = 1; this.qWhy[i] = 2; this.qDay[i] = this.day; if (s !== EXPOSED && !this.reported[i]) this._report(i, ev, "trace"); ev.push({ type: "quarantine", i }); }
    }
    // end of day: costs, vaccination roll-out, trust, records
    this.t++;
    if (this.t % spd === 0) {
      for (let i = 0; i < n; i++) { if (st[i] === DECEASED) continue; const adult = this.age[i] >= 18 && this.age[i] < 65; if (adult && (this.isolated[i] || this.quarantined[i])) this.cost.homeDays++; else if (adult && (st[i] === SEVERE || this.symptomatic(i))) this.cost.sickDays++; if (this.visited[i] && !this.ppe[i]) { if (this.masked(i)) this.cost.maskDays++; if (this.shielded(i)) this.cost.shieldDays++; } }
      this.pressureLog.push(this.pressure); this.pressure = 0; this._applyVaccination(false); this._updateTrust(); this._record();
    }
    return ev;
  }
  _startDay(day) { // historical replay: follow the reported curve
    const P = this.P, st = this.state; let need = 0;
    if (P.track) { // re-estimate today's transmission level so that expected new infections equal the target
      const target = P.track[Math.min(day, P.track.length - 1)], log = this.pressureLog, recent = log.slice(-2), press = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
      if (press > 0) this.curMult = Math.min(20, Math.max(0.02, target / press));
      let active = 0; for (let i = 0; i < this.n; i++) if (st[i] === EXPOSED || st[i] === INFECTIOUS) active++;
      need = active === 0 && target > 0.3 ? 1 : 0;       // the outbreak died out by chance: one imported case restarts it
      this.betaUsed[day] = this.curMult; this.importUsed[day] = need;
    } else need = (P.importSchedule && P.importSchedule[day]) || 0;
    for (let k = 0, g = 0; k < need && g < 400; g++) { const i = Math.floor(this.rnd() * this.n); if (st[i] === HEALTHY && !this.role[i]) { this._infect(i, -1, false); k++; } }
  }
  _report(i, ev, how) { this.reported[i] = 1; this.revealed[i] = 1; this.totals.reported++; this._day.rep++; this.isoAt[i] = this.t + this.P.isoDelay * this.P.stepsPerDay * (how === "test" ? 1 : 0); this._ev.push({ type: "report", i, how }); }
  _trace(i) { const P = this.P, ks = this.kids[i]; if (!P.trace || !ks) return;
    for (const j of ks) if ((this.state[j] === EXPOSED || this.state[j] === INFECTIOUS) && this.traceAt[j] === Infinity && this.rnd() < P.trace * this.compliance()) this.traceAt[j] = this.t + P.traceDelay * P.stepsPerDay; }
  _becomeSevere(i, ev) {
    this.state[i] = SEVERE; this.timer[i] = this.severeSteps[i]; this.severeDay[i] = this.day; this.totals.severe++; this._day.sev++;
    if (!this.reported[i]) this._report(i, ev, "hospital");
    this.isolated[i] = 0; this.quarantined[i] = 0; this.homeUntil[i] = Infinity;
    if (this.bed[i] >= 0) { ev.push({ type: "severe", i, bed: true, inpatient: true }); return; }
    let slot = -1; for (let b = 0; b < this.beds.length; b++) if (this.beds[b].by < 0) { slot = b; break; }
    let used = 0; for (const b of this.beds) if (b.by >= 0) used++; if (used >= this.bedLimit) slot = -1;
    if (slot >= 0) { const b = this.beds[slot]; this._release(i); this._endTalk(i); this.mode[i] = M.FIXED; b.by = i; this.bed[i] = slot; this.away[i] = 0; this.zone[i] = b.zone; this.x[i] = b.x; this.z[i] = b.z; this.px[i] = b.x; this.pz[i] = b.z; this.yaw[i] = b.yaw; this.pose[i] = 2; ev.push({ type: "severe", i, bed: true, overflow: !!b.overflow }); }
    else if (!this.beds.length) { this.away[i] = 1; ev.push({ type: "severe", i, bed: true, offsite: true }); }   // no hospital on site: taken to one elsewhere
    else { this.away[i] = 1; this.noBed[i] = 1; this.totals.noBed++; ev.push({ type: "severe", i, bed: false }); }
  }
  _leaveCare(i, dead) { const b = this.bed[i]; if (b >= 0 && (dead || this.role[i] !== 4 || this.env.type !== "hospital")) { this.beds[b].by = -1; this.bed[i] = -1; this.pose[i] = 0; this.away[i] = 1; }
    this.isolated[i] = 0; this.quarantined[i] = 0; this.homeUntil[i] = Infinity; this.guardAt[i] = Infinity; if (dead) this.testAt[i] = Infinity; this.traceAt[i] = Infinity; this.isoAt[i] = Infinity; this.reportAt[i] = Infinity; }
  _recover(i, ev) { const wasSevere = this.state[i] === SEVERE; this._leaveCare(i, false); this.thr[i] = this.dose[i] - Math.log(1 - this.thrStream()); this.state[i] = RECOVERED; this.recoveredAt[i] = this.t; this.outDay[i] = this.day; this.noBed[i] = 0; this.poi[i] = -1; ev.push({ type: "recover", i, wasSevere }); }
  _die(i, ev) { this._leaveCare(i, true); this.state[i] = DECEASED; this.away[i] = 1; this.outDay[i] = this.day; this.totals.deaths++; this._day.deaths++; this.deathDelays.push(this.day - this.infDay[i]); ev.push({ type: "death", i }); }
  _updateTrust() { // deaths, long restrictions and heavy-handed guards erode trust; calm days and visible care rebuild it
    const P = this.P, h = this.hist, d = this._day;
    let t = this.trust - 2.5 * d.deaths - 0.12 * (P.dist > 0.3 ? 1 : 0) - 0.08 * (P.iso > 0.5 ? 1 : 0) + (P.guard > 0 ? (GUARDS[P.guardType] || GUARDS.bhw).daily : 0);
    const recent = h.slice(-7).reduce((a, r) => a + r.newReported, 0), before = h.slice(-14, -7).reduce((a, r) => a + r.newReported, 0);
    if (h.length >= 14) t += recent < before ? 0.5 : recent > before * 1.5 ? -0.4 : 0;
    if (d.deaths === 0 && recent === 0) t += 0.3;
    this.trust = Math.min(100, Math.max(15, t));
  }
  _record() {
    const c = this.counts(); let iso = 0, hidden = 0, inBeds = 0, vax = 0, nb = 0;
    for (let i = 0; i < this.n; i++) { iso += this.isolated[i] | this.quarantined[i]; if (this.state[i] === INFECTIOUS && !this.revealed[i]) hidden++; if (this.bed[i] >= 0) inBeds++; if (this.state[i] === SEVERE && this.noBed[i]) nb++; vax += this.vaccinated[i]; }
    this.hist.push({ day: Math.round(this.day), c, newInfections: this._day.inf, newReported: this._day.rep, newDeaths: this._day.deaths, newSevere: this._day.sev,
      isolated: iso, hidden, bedsUsed: inBeds, bedLimit: this.bedLimit, noBed: nb, trust: Math.round(this.trust), vaccinated: vax });
    this._day = { inf: 0, rep: 0, deaths: 0, sev: 0 };
  }
  finished() { const c = this.counts(); return (c[EXPOSED] + c[INFECTIOUS] + c[SEVERE] === 0 && !this.P.betaSchedule && !this.P.track) || this.day >= this.P.maxDays; }
  /* ---------- actions the player can take on one person ---------- */
  playerIsolate(i) { const s = this.state[i]; if ((s !== EXPOSED && s !== INFECTIOUS) || this.isolated[i] || this.quarantined[i]) return false;
    if (s === INFECTIOUS && !this.reported[i]) this._report(i, null, "trace"); this.revealed[i] = 1; this.isolated[i] = 1; this.away[i] = 1; this.qWhy[i] = 4; this.qDay[i] = this.day; this._trace(i); return true; }
  playerTest(i) { // a swab now; the result comes back after the usual wait
    if (this.state[i] === DECEASED || this.ptest[i] === 1) return null; this.ptest[i] = 1; this.ptestDay[i] = this.day; this.testAt[i] = this.t + this.P.reportDelay * this.P.stepsPerDay;
    return this.P.reportDelay > 0 ? "pending" : this._testResult(i) ? "pos" : "neg"; }
  _testResult(i) { this.testAt[i] = Infinity; const pos = this.state[i] === INFECTIOUS || this.state[i] === SEVERE; this.ptest[i] = pos ? 2 : 3; this.ptestDay[i] = this.day;
    if (pos && !this.reported[i]) this._report(i, null, "test"); this._ev.push({ type: "ptest", i, pos }); return pos; }
  playerAdmit(i) { if (this.state[i] !== SEVERE || this.bed[i] >= 0 || !this.noBed[i] || !this.freeBeds()) return false; this.mode[i] = M.FIXED;
    for (let s = 0; s < this.beds.length; s++) if (this.beds[s].by < 0) { const b = this.beds[s]; b.by = i; this.bed[i] = s; this.noBed[i] = 0; this.away[i] = 0; this.zone[i] = b.zone; this.x[i] = this.px[i] = b.x; this.z[i] = this.pz[i] = b.z; this.yaw[i] = b.yaw; this.pose[i] = 2; return true; }
    return false; }
  bedsUsed() { let u = 0; for (const b of this.beds) if (b.by >= 0) u++; return u; }
  freeBeds() { return Math.max(0, this.bedLimit - this.bedsUsed()); }
  /* ---------- reading results ---------- */
  person(i) {
    const g = this.gender[i], L = k => this.look[i * 4 + k], a = this.age[i], r = this.role[i], t = this.env.type;
    const job = t === "hospital" && r ? ["", "Doctor", "Nurse", ["Hospital guard", "Cleaner", "Receptionist"][this.sub[i]], "Inpatient", a < 18 ? "Student" : a >= 60 ? "Retiree" : JOBS[Math.floor(L(3) * 12)]][r] : r === 2 ? "Vendor" : r === 3 ? "Jeepney driver" : a < 18 ? "Student" : a >= 60 ? "Retiree" : JOBS[Math.floor(L(3) * 12)];
    return { name: FIRST[g][Math.floor(L(1) * 12)] + " " + LAST[Math.floor(L(2) * 14)], gender: g ? "Female" : "Male", age: a, job, persona: PERSONAS[this.persona[i]][0] };
  }
  doing(i) { // what the person is doing right now, in plain words
    const t = this.env.type, s = this.state[i];
    if (this.bed[i] >= 0) return s === SEVERE ? (this.beds[this.bed[i]].overflow ? "in a bed outside, on oxygen" : "in a ward bed, on oxygen") : this.beds[this.bed[i]].overflow ? "admitted, resting in a bed outside" : "admitted, resting in a ward bed";
    if (this.away[i]) return this.isolated[i] || this.quarantined[i] ? "at home" : this.P.routines || t === "jeep" ? (this.visited[i] ? "back home for the day" : this.go[i] ? "not here yet today" : "at home today") : "away";
    if (t === "jeep") return this.zone[i] === 1 ? "waiting at the jeepney stop" : this.seat[i] === 17 ? "driving the jeep" : this.seat[i] === 16 ? "riding in the front seat" : `riding on the ${this.seat[i] < 8 ? "left" : "right"} bench, seat ${this.seat[i] % 8 + 1}`;
    const a = this.act[i], pois = this._pois(), q = this.poiK[i] >= 0 && this.slotK[i] >= 0 ? pois[this.poiK[i]] : this.role[i] === 2 && t === "walk" ? this.env.pois[this.home[i]] : null;
    const txt = { 0: "walking around", 1: q ? `buying ${q.goods} at ${q.label || "a stall"}` : "buying", 2: `sitting ${q && q.label || "on a bench"}`, 3: `chatting in a group ${q && q.label || ""}`.trim(), 4: q ? `queuing at ${q.label}` : "queuing",
      5: q ? `selling ${q.goods} at ${q.label || "their stall"}` : "selling", 6: "on shift, walking to the next bed", 7: ["on guard at the entrance", "cleaning the ward", "at the reception desk"][this.sub[i]], 8: "visiting a patient at the bedside",
      9: "waiting on a bench outside", 10: "registering at the desk", 11: "chatting outside while waiting", 12: "walking around outside", 13: `eating at ${q && q.label || "a food cart"}, mask off`, 14: "eating at a canteen table, mask off",
      15: "stopped to talk with someone", 16: "walking with friends", 17: "heading home", 21: "on shift, a long bedside procedure", 22: "on shift, checking a patient", 23: `sharing food ${q && q.label || "on a bench"}, mask off`, 24: "cleaning the ward" }[a];
    const r = this.role[i]; let o = txt || (t === "hospital" && r === 1 || r === 2 ? "on shift" : "walking around");
    if (this.wheel[i]) o += ", in a wheelchair"; if (this.voc[i] === 2) o += ", shouting"; else if (this.voc[i] === 1) o += ", talking";
    return o;
  }
  whereabouts(i) {
    const s = this.state[i];
    if (s === DECEASED) return "died";
    if (s === SEVERE) return this.bed[i] >= 0 ? this.doing(i) : this.noBed[i] ? "severe at home, no bed free" : "in a hospital elsewhere";
    if (this.isolated[i]) return this.qWhy[i] === 3 ? "at home with a quarantine letter from the guard" : "isolating at home";
    if (this.quarantined[i]) return this.qWhy[i] === 3 ? "at home with a quarantine letter from the guard" : "quarantined at home after contact tracing";
    return this.doing(i);
  }
  quarantineReason(i) { // why this person was, or was not, sent home
    const s = this.state[i], P = this.P, d = Math.floor(this.qDay[i]);
    if (this.qWhy[i]) return ["", `Isolated from day ${d} after a positive test`, `Quarantined from day ${d} as a traced contact`, `Quarantined by guard, day ${d}`, `Isolated by you on day ${d}`][this.qWhy[i]];
    if (s === SEVERE || this.severeDay[i] >= 0) return "Never isolated at home: went straight into care when the illness turned severe";
    if (s === EXPOSED) return "Not quarantined: not ill yet, so there is nothing to notice";
    if (this.silent[i]) return "Not quarantined: no symptoms, so never tested";
    if (!this.tested[i]) return "Not quarantined: had symptoms but did not get tested";
    if (!this.reported[i]) return s === INFECTIOUS ? `Not quarantined yet: test result due on day ${Math.ceil(this.reportAt[i] / P.stepsPerDay)}` : "Not quarantined: recovered before the test result came back";
    if (!(P.iso > 0)) return "Not quarantined: tested positive, but Isolation is switched off";
    if (!this.willIsolate(i)) return "Not quarantined: tested positive but did not stay home";
    return s === INFECTIOUS ? "Tested positive: starts isolating within a day" : "Not quarantined: recovered before isolation started";
  }
  summary() {
    const h = this.hist, N = this.n, last = h[h.length - 1]; let pk = 0, pd = 0, ever = 0;
    for (const r of h) { const a = r.c[INFECTIOUS] + r.c[SEVERE]; if (a > pk) { pk = a; pd = r.day; } }
    for (let i = 0; i < N; i++) if (this.infections[i]) ever++;
    return { seed: this.seed, days: last.day, everInfected: ever, attack: 100 * ever / N, peak: pk, peakPct: 100 * pk / N, peakDay: pd, deaths: this.totals.deaths, severe: this.totals.severe,
      reported: this.totals.reported, reinfections: this.totals.reinfections, noBed: this.totals.noBed, trust: Math.round(this.trust), cost: Object.assign({}, this.cost), driver: Object.assign({ infectedDay: this.env.type === "jeep" && this.infections[0] ? this.infDay[0] : -1 }, this.driver), byKind: Object.assign({}, this.byKind),
      curveActive: h.map(r => 100 * (r.c[INFECTIOUS] + r.c[SEVERE]) / N), newInf: h.map(r => r.newInfections), newRep: h.map(r => r.newReported), deathDelays: this.deathDelays.slice() };
  }
}
function makeParams(over) { over = over || {}; const P = Object.assign({}, DEFAULTS, over); const e = ENVS[P.env]; if (over.population == null) P.population = e.pop; if (over.maxDays == null) P.maxDays = e.days;
  if (e.type === "jeep") { P.loads = Math.max(2, Math.min(16, 2 * Math.round(P.loads / 2))); P.population = jeepPop(P.loads); } if (P.stay == null) P.stay = e.stay || 2; return P; }
function runHeadless(P, seed, untilDay) { const s = new Sim(P, seed, { log: false }); const end = untilDay == null ? Infinity : untilDay; while (!s.finished() && s.day < end) s.step(); return s; }
function stats(v) { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n; const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1)) : 0;
  const df = Math.max(1, n - 1), q = 1.959964, tc = q + (q ** 3 + q) / (4 * df) + (5 * q ** 5 + 16 * q ** 3 + 3 * q) / (96 * df * df), half = tc * sd / Math.sqrt(n);
  return { n, mean: m, sd, lo: m - half, hi: m + half, min: Math.min(...v), max: Math.max(...v) }; }
function smooth7(v) { return v.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 3); k <= Math.min(v.length - 1, i + 3); k++) { s += v[k]; c++; } return s / c; }); }

/* ---------- historical replay: fit a day-by-day transmission level to a reported wave ---------- */
const REPORT_LAG = 9;   // days from infection to appearing in the reported counts (incubation + testing)
function replayTarget(wave, N, attack) { // reported 7-day cases, shifted back to infection day and scaled to N people
  const c = wave.cases7, days = c.length, t = []; for (let d = 0; d < days; d++) t.push(c[Math.min(days - 1, d + REPORT_LAG)]);
  const total = t.reduce((a, b) => a + b, 0), scale = attack * N / total; return { target: t.map(v => v * scale), scale };
}
function replayParams(wave, over) {
  const P = makeParams(Object.assign({ env: "cityhall", maxDays: wave.days, vaxSchedule: wave.fullyVaccinated.map(v => v / 100), trustEffect: false, loads: 16 }, over || {}));
  const tg = replayTarget(wave, P.population, 0.55); P.initial = Math.max(2, Math.round(tg.target[0] * 6));
  return { P, target: tg.target, scale: tg.scale };
}
/* Calibration: one tracking run re-estimates the transmission level every day so the simulated curve follows the
   reported one. The levels it found are then frozen into a schedule; replaying with the same seed reproduces the
   run exactly, and a what-if keeps the schedule but changes the measures. */
function calibrateReplay(wave, seed, over) {
  const { P, target, scale } = replayParams(wave, over);
  P.track = target; const s = runHeadless(P, seed);
  P.track = null; P.betaSchedule = s.betaUsed.slice(); P.importSchedule = s.importUsed.slice();
  while (P.betaSchedule.length < wave.days) P.betaSchedule.push(P.betaSchedule[P.betaSchedule.length - 1] || 1);
  return { P, target, scale, match: matchScore(s.hist.slice(1).map(r => r.newInfections), target) };
}
function matchScore(simDaily, target) { const a = smooth7(simDaily), b = smooth7(target), n = Math.min(a.length, b.length); let e = 0; for (let d = 0; d < n; d++) e += (a[d] - b[d]) ** 2; return Math.max(0, 1 - Math.sqrt(e / Math.max(1, n)) / Math.max(...b)); }

if (typeof module !== "undefined") module.exports = { M, SUB, Q, VOICE, buildSlots, REPORT_LAG, replayTarget, Sim, ENVS, DEFAULTS, KINDS, GUARDS, jeepPop, makeParams, runHeadless, stats, smooth7, replayParams, calibrateReplay, matchScore, STATE_NAMES, HEALTHY, EXPOSED, INFECTIOUS, SEVERE, RECOVERED, DECEASED };
