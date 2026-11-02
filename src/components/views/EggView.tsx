import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { Molecule } from '../../utils/types';
import type { FDADrug } from '../../utils/fda_reference';

// Exact polygon coordinates from the supporting information of:
// Daina, A. & Zoete, V., ChemMedChem 11, 1117–1121 (2016).
// Format: [tpsa, wlogp] pairs. Axis: x = TPSA (Å²), y = WLogP.
const GIA_COORDS: [number, number][] = [[97.80552243681136,-2.227039047489081],[101.88198219217963,-2.1900004937640487],[105.83667285876659,-2.1352635055090943],[109.65398707923741,-2.063044104609906],[113.31885965832892,-1.9736273080479292],[116.81682701829244,-1.8673660030685453],[120.13408428002757,-1.7446795544963347],[123.25753974463277,-1.6060521496937052],[126.17486656036041,-1.452030887694577],[128.87455137106866,-1.2832236200544374],[131.3459397541782,-1.100296551937959],[133.57927826881107,-0.903971612911568],[135.56575294816514,-0.6950236078172709],[137.29752408421504,-0.4742771589719089],[138.76775716745777,-0.2426034517596168],[139.97064985959926,-0.0009167964611120461],[140.90145489273314,0.2498289801112721],[141.556498804638,0.5086442989322527],[141.9331964362546,0.7745077341799151],[142.03006113412775,1.0463700443367885],[141.84671061754818,1.323158313066756],[141.38386848723997,1.6037801835256746],[140.64336136963902,1.88712816939478],[139.628111708033,2.1720840256232266],[138.34212622901268,2.457523161630431],[136.790480129753,2.7423190795513075],[134.97929704852805,3.025347820008701],[132.91572489750854,3.3054923978675586],[130.60790765321815,3.5816472104649564],[128.06495321597865,3.8527224009187018],[125.29689746518848,4.1176481592945535],[122.31466465229157,4.375378944657261],[119.13002428774791,4.624897611343],[115.75554469215258,4.865219423168597],[112.20454339481628,5.095395939735363],[108.49103457556141,5.314518759490062],[104.62967375715677,5.521723104770812],[100.63569996666462,5.716191234689457],[96.52487559396305,5.8971556723812375],[92.313424184794,6.063902233885377],[88.0179664138405,6.215772846702879],[83.6554544905163,6.352168146908026],[79.2431052563408,6.472549844564003],[74.79833223793057,6.576442848107324],[70.3386769237657,6.663437139317204],[65.88173953594848,6.733189391470147],[61.445109570167645,6.785424324293678],[57.04629637799464,6.8199357903718125],[52.7026600654724,6.836587588714733],[48.43134298070782,6.83531400228186],[44.24920206085525,6.816120057336999],[40.17274230548697,6.779081503611968],[36.218051638900036,6.7243445153570125],[32.400737418429216,6.652125114457824],[28.735864839337697,6.562708317895847],[25.237897479374148,6.456447012916463],[21.92064021763908,6.333760564344252],[18.79718475303387,6.195133159541625],[15.879857937306236,6.0411118975424944],[13.180173126598005,5.872304629902357],[10.708784743488392,5.689377561785878],[8.475446228855569,5.493052622759485],[6.488971549501496,5.284104617665191],[4.757200413451594,5.063358168819828],[3.286967330208895,4.8316844616075345],[2.084074638067364,4.589997806309031],[1.1532696049334672,4.339252029736645],[0.4982256930286379,4.0804367109156665],[0.12152806141202838,3.8145732756680006],[0.024663363538902687,3.5427109655111297],[0.2080138801184492,3.265922696781163],[0.6708560104266521,2.9853008263222423],[1.4113631280275918,2.701952840453139],[2.426612789633675,2.416996984224689],[3.7125982686539536,2.1315578482174877],[5.264244367913619,1.846761930296613],[7.0754274491385845,1.5637331898392164],[9.138999600158078,1.2835886119803601],[11.4468168444485,1.0074337993829612],[13.989771281687991,0.7363586089292161],[16.75782703247815,0.4714328505533679],[19.740059845375065,0.21370206519065607],[22.92470020991869,-0.03581660149508132],[26.29917980551407,-0.27613841332067823],[29.85018110285037,-0.506314929887444],[33.563689922105276,-0.7254377496421445],[37.425050740509896,-0.9326420949228948],[41.419024531002,-1.127110224841536],[45.529848903703616,-1.3080746625333208],[49.7413003128726,-1.4748212240374596],[54.0367580838262,-1.6266918368549592],[58.39927000715034,-1.7630871370601089],[62.81161924132584,-1.8834688347160848],[67.25639225973609,-1.9873618382594065],[71.71604757390092,-2.074356129469285],[76.17298496171819,-2.144108381622228],[80.609614927499,-2.196343314445759],[85.00842811967199,-2.2308547805238947],[89.35206443219425,-2.247506578866816],[93.62338151695882,-2.2462329924339417],[97.80552243681143,-2.2270390474890807]];
const BBB_COORDS: [number, number][] = [[40.97017925131679,0.4062562899766126],[43.53440363567211,0.4169942065264866],[46.077057183913354,0.4386559712786629],[48.58810520411346,0.4711560951439837],[51.05763773692548,0.5143663149814472],[53.47590866566447,0.5681160997942261],[55.83337417977759,0.6321933237376053],[58.120730439904186,0.7063451032827793],[60.328950295879224,0.7902787952326094],[62.449318912770856,0.8836631516506256],[64.47346816435247,0.9861296271452998],[66.39340965827392,1.0972738333503356],[68.20156626259653,1.2166571348607977],[69.8908020092712,1.3438083803266692],[71.45445025654422,1.4782257618719723],[72.88633999914657,1.61937879550121],[74.1808202224323,1.766710414677333],[75.33278220435197,1.9196391688088683],[76.33767967724427,2.07756151796976],[77.19154676987765,2.239854214795729],[77.89101365893231,2.405876764156885],[78.43331986815312,2.5749739508993854],[78.81632516268847,2.7464784256803143],[79.03851799561927,2.9197133386906526],[79.09902147334422,3.093995010872254],[78.99759681627812,3.2686356320867374],[78.73464430120595,3.442945975587881],[78.31120168157305,3.6162381180847065],[77.72894009194661,3.7878281546604287],[76.99015745281086,3.9570388978327133],[76.09776940172482,4.1232025501032945],[75.05529778663279,4.285663339449613],[73.86685676673952,4.4437801073573935],[72.53713657580352,4.596928839180382],[71.071385011927,4.744505126841076],[69.47538672689447,4.885926554153269],[67.75544039679461,5.020634995352665],[65.91833386402362,5.148098817764284],[63.97131734877222,5.267814979913747],[61.92207483571886,5.3793110168021645],[59.77869374885272,5.482146904509627],[57.549633034105966,5.575916796768607],[55.243689775758746,5.660250626653745],[52.86996447836648,5.734815567066945],[50.43782515122604,5.799317344253877],[47.956870337122915,5.853501399168046],[45.43689123126793,5.897153892099043],[42.8878330399229,5.930102546600198],[40.319755731215174,5.952217329385],[37.74279433303931,5.9634109635090855],[35.167118934732244,5.963639272812449],[32.602894550376924,5.952901356262576],[30.06024100213569,5.931239591510399],[27.54919298193556,5.898739467645077],[25.079660449123548,5.855529247807613],[22.66138952038456,5.801779462994835],[20.303924006271433,5.7377022390514565],[18.016567746144844,5.663550459506283],[15.808347890169804,5.579616767556452],[13.687979273278186,5.486232411138436],[11.663830021696565,5.38376593564376],[9.743888527775118,5.272621729438726],[7.935731923452518,5.153238427928264],[6.2464961767778435,5.026087182462394],[4.682847929504812,4.8916698009170885],[3.2509581869024937,4.750516767287851],[1.9564779636167104,4.603185148111728],[0.8045159816970635,4.450256393980193],[-0.20038149119524168,4.2923340448193015],[-1.054248583828624,4.130041347993332],[-1.7537154728832645,3.9640187986321784],[-2.2960216821040977,3.7949216118896762],[-2.67902697663943,3.623417137108748],[-2.9012198095702453,3.450182224098408],[-2.961723287295181,3.275900551916808],[-2.8602986302290945,3.1012599307023248],[-2.5973461151568977,2.9269495872011797],[-2.173903495524005,2.753657444704355],[-1.5916419058975677,2.582067408128632],[-0.8528592667618298,2.4128566649563483],[0.039528784324221584,2.246693012685768],[1.0820003994162777,2.0842322233394484],[2.2704414193095257,1.9261154554316693],[3.6001616102455305,1.7729667236086788],[5.0659131741220245,1.6253904359479865],[6.6619114591545925,1.4839690086357915],[8.381857789254436,1.3492605674363958],[10.21896432202541,1.2217967450247778],[12.165980837276834,1.102080582875313],[14.215223350330179,0.9905845459868972],[16.358604437196348,0.8877486582794322],[18.58766515194309,0.7939787660204534],[20.893608410290287,0.7096449361353171],[23.26733370768257,0.6350799957221163],[25.699473034822983,0.5705782185351836],[28.18042784892613,0.5163941636210154],[30.700406954781126,0.4727416706900189],[33.24946514612614,0.4397930161888647],[35.817542454833884,0.41767823340406107],[38.39450385300971,0.4064845992799761],[40.970179251316814,0.4062562899766127]];

interface EggViewProps {
  molecules: Molecule[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
  fdaData?: FDADrug[];
}

function EggView({ molecules, selectedMolIdx, setSelectedMolIdx, fdaData }: EggViewProps) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const molPositionsRef = useRef<{ x: number; y: number; idx: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);

  // Zoom / pan state (data-space coordinates)
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0); // offset in data-space units (TPSA)
  const [panY, setPanY] = useState(0); // offset in data-space units (WLogP)
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const isZoomed = zoom !== 1 || panX !== 0 || panY !== 0;

  const resetView = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  // Observe container size changes for responsive redraw
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const drawCanvas = useCallback(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    // Responsive sizing breakpoints
    const isCompact = W < 400;
    const isMedium = W >= 400 && W < 600;

    // Scale paddings based on available width
    const padLeft = isCompact ? 38 : isMedium ? 45 : 55;
    const padRight = isCompact ? 10 : 20;
    const padTop = isCompact ? 12 : 20;
    const padBottom = isCompact ? 32 : 50;

    // Scale font sizes
    const axisFontSize = isCompact ? 10 : 12;
    const tickFontSize = isCompact ? 8 : 10;
    const labelFontSize = isCompact ? 8 : isMedium ? 9 : 10;
    const regionFontSize = isCompact ? 9 : 11;
    const refLineFontSize = isCompact ? 8 : 10;

    // Scale dot sizes (constant screen-space, not zoomed)
    const dotRadius = isCompact ? 4 : 6;
    const selectedRadius = isCompact ? 7 : 10;
    const fdaDotRadius = isCompact ? 2 : 3;

    // Base data range
    const baseXMin = -5, baseXMax = 160;
    const baseYMin = -3, baseYMax = 8;

    // Apply zoom + pan: shrink the visible data range around center
    const xRange = (baseXMax - baseXMin) / zoom;
    const yRange = (baseYMax - baseYMin) / zoom;
    const xCenter = (baseXMin + baseXMax) / 2 + panX;
    const yCenter = (baseYMin + baseYMax) / 2 + panY;
    const xMin = xCenter - xRange / 2;
    const xMax = xCenter + xRange / 2;
    const yMin = yCenter - yRange / 2;
    const yMax = yCenter + yRange / 2;

    const plotW = W - padLeft - padRight;
    const plotH = H - padTop - padBottom;

    // toPixel: tpsa → x, wlogp → y
    function toPixel(tpsa: number, wlogp: number): [number, number] {
      const px = padLeft + ((tpsa - xMin) / (xMax - xMin)) * plotW;
      const py = padTop + ((yMax - wlogp) / (yMax - yMin)) * plotH;
      return [px, py];
    }

    // point-in-polygon test (ray casting)
    function pointInPolygon(tpsa: number, wlogp: number, poly: [number, number][]): boolean {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        const intersect = ((yi > wlogp) !== (yj > wlogp)) && (tpsa < (xj - xi) * (wlogp - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    // Detect theme
    const isDark = document.documentElement.classList.contains('dark');

    // Background
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    ctx.fillRect(0, 0, W, H);

    // Clip to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, plotW, plotH);
    ctx.clip();

    // Grid — compute nice tick steps based on visible range
    const xTickStep = niceStep(xRange, isCompact ? 4 : 8);
    const yTickStep = niceStep(yRange, isCompact ? 4 : 8);

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-5').trim();
    ctx.lineWidth = 0.5;
    const xTickStart = Math.ceil(xMin / xTickStep) * xTickStep;
    for (let x = xTickStart; x <= xMax; x += xTickStep) {
      const [px] = toPixel(x, 0);
      ctx.beginPath(); ctx.moveTo(px, padTop); ctx.lineTo(px, H - padBottom); ctx.stroke();
    }
    const yTickStart = Math.ceil(yMin / yTickStep) * yTickStep;
    for (let y = yTickStart; y <= yMax; y += yTickStep) {
      const [, py] = toPixel(0, y);
      ctx.beginPath(); ctx.moveTo(padLeft, py); ctx.lineTo(W - padRight, py); ctx.stroke();
    }

    // Draw GIA (egg white) polygon
    ctx.save();
    ctx.beginPath();
    GIA_COORDS.forEach(([tpsa, wlogp], i) => {
      const [px, py] = toPixel(tpsa, wlogp);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = isDark ? 'rgba(240, 240, 235, 0.10)' : 'rgba(180, 180, 170, 0.15)';
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(200, 200, 195, 0.45)' : 'rgba(140, 140, 130, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Draw BBB (yolk) polygon
    ctx.save();
    ctx.beginPath();
    BBB_COORDS.forEach(([tpsa, wlogp], i) => {
      const [px, py] = toPixel(tpsa, wlogp);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = isDark ? 'rgba(255, 220, 80, 0.13)' : 'rgba(255, 200, 50, 0.20)';
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(255, 200, 50, 0.55)' : 'rgba(200, 160, 30, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Region labels (only if visible in viewport)
    const giaCenter: [number, number] = [70, 6.3];
    const bbbCenter: [number, number] = [40, 5.4];
    if (giaCenter[0] > xMin && giaCenter[0] < xMax && giaCenter[1] > yMin && giaCenter[1] < yMax) {
      ctx.font = `${regionFontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isDark ? 'rgba(200,200,195,0.45)' : 'rgba(120,120,110,0.65)';
      const [wlx, wly] = toPixel(giaCenter[0], giaCenter[1]);
      ctx.fillText(isCompact ? 'GI Abs.' : 'GI Absorbed', wlx, wly);
    }
    if (bbbCenter[0] > xMin && bbbCenter[0] < xMax && bbbCenter[1] > yMin && bbbCenter[1] < yMax) {
      ctx.font = `${regionFontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isDark ? 'rgba(255,200,50,0.55)' : 'rgba(180,140,20,0.7)';
      const [ylx, yly] = toPixel(bbbCenter[0], bbbCenter[1]);
      ctx.fillText(isCompact ? 'BBB' : 'BBB Penetrant', ylx, yly);
    }

    // Reference lines: TPSA=140 (vertical) and LogP=5 (horizontal) per Ro5
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    // TPSA=140 vertical line
    if (140 >= xMin && 140 <= xMax) {
      const [tpsaVx, tpsaVy1] = toPixel(140, yMax);
      const [, tpsaVy2] = toPixel(140, yMin);
      ctx.strokeStyle = 'rgba(239,68,68,0.35)';
      ctx.beginPath(); ctx.moveTo(tpsaVx, tpsaVy1); ctx.lineTo(tpsaVx, tpsaVy2); ctx.stroke();
      ctx.font = `${refLineFontSize}px Inter, sans-serif`;
      ctx.fillStyle = 'rgba(239,68,68,0.5)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('TPSA=140', tpsaVx, tpsaVy2 + 2);
    }
    // LogP=5 horizontal line
    if (5 >= yMin && 5 <= yMax) {
      const [logpHx1, logpHy] = toPixel(xMin, 5);
      const [logpHx2] = toPixel(xMax, 5);
      ctx.strokeStyle = 'rgba(239,68,68,0.35)';
      ctx.beginPath(); ctx.moveTo(logpHx1, logpHy); ctx.lineTo(logpHx2, logpHy); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(239,68,68,0.5)';
      ctx.fillText('LogP=5', logpHx1 + 4, logpHy - 2);
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Draw FDA reference dots (behind user molecules)
    if (fdaData && fdaData.length > 0) {
      fdaData.forEach(drug => {
        const tpsa = drug.tpsa;
        const wlogp = drug.logp;
        if (tpsa < xMin || tpsa > xMax || wlogp < yMin || wlogp > yMax) return;
        const [px, py] = toPixel(tpsa, wlogp);
        ctx.beginPath();
        ctx.arc(px, py, fdaDotRadius, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? 'rgba(107,114,128,0.3)' : 'rgba(107,114,128,0.25)';
        ctx.fill();
        ctx.strokeStyle = isDark ? 'rgba(107,114,128,0.4)' : 'rgba(107,114,128,0.35)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });
    }

    // Draw molecules with collision-avoiding labels
    const labelPositions: { x: number; y: number; w: number; h: number }[] = [];
    const positions: { x: number; y: number; idx: number }[] = [];

    // On very compact screens with many molecules, skip labels to avoid clutter
    const skipLabels = isCompact && molecules.length > 8;

    molecules.forEach((m, molIdx) => {
      const tpsa = m.props.TPSA;
      const wlogp = m.props.LogP;  // RDKit MolLogP = WLogP (Wildman-Crippen)

      // Skip if out of visible viewport (with small margin)
      if (tpsa < xMin - 5 || tpsa > xMax + 5 || wlogp < yMin - 1 || wlogp > yMax + 1) return;

      const [px, py] = toPixel(tpsa, wlogp);

      const inYolk = pointInPolygon(tpsa, wlogp, BBB_COORDS);
      const inWhite = pointInPolygon(tpsa, wlogp, GIA_COORDS);

      let fillColor, strokeColor;
      if (inYolk) {
        fillColor = isDark ? 'rgba(255, 200, 50, 0.9)' : 'rgba(230, 180, 30, 0.9)';
        strokeColor = isDark ? '#cca000' : '#997700';
      } else if (inWhite) {
        fillColor = isDark ? 'rgba(240, 240, 235, 0.9)' : 'rgba(160, 160, 150, 0.7)';
        strokeColor = isDark ? '#999' : '#666';
      } else {
        fillColor = isDark ? 'rgba(200, 200, 200, 0.4)' : 'rgba(140, 140, 140, 0.5)';
        strokeColor = isDark ? '#555' : '#888';
      }

      positions.push({ x: px, y: py, idx: molIdx });

      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Selected molecule highlight
      if (selectedMolIdx === molIdx) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#14b8a6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, selectedRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Label with collision avoidance (skip on very compact screens with many molecules)
      if (!skipLabels) {
        ctx.font = `${labelFontSize}px Inter, sans-serif`;
        const maxLabelLen = isCompact ? 8 : 12;
        const label = m.name.length > maxLabelLen ? m.name.slice(0, maxLabelLen - 2) + '\u2026' : m.name;
        const tw = ctx.measureText(label).width;
        const th = labelFontSize + 2;

        // Try positions: above, below, right, left
        const labelOffset = dotRadius + 4;
        const candidates = [
          { x: px - tw / 2, y: py - labelOffset - 2 },
          { x: px - tw / 2, y: py + labelOffset + th },
          { x: px + labelOffset, y: py + 3 },
          { x: px - tw - labelOffset, y: py + 3 },
        ];

        let best = candidates[0];
        for (const c of candidates) {
          const overlaps = labelPositions.some(
            p => c.x < p.x + p.w + 2 && c.x + tw > p.x - 2 && c.y - th < p.y + 2 && c.y > p.y - p.h - 2
          );
          if (!overlaps) { best = c; break; }
        }

        labelPositions.push({ x: best.x, y: best.y, w: tw, h: th });
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-label').trim();
        ctx.textAlign = 'left';
        ctx.fillText(label, best.x, best.y);
      }
    });

    molPositionsRef.current = positions;

    // Restore from clip
    ctx.restore();

    // Axis labels (outside clip)
    ctx.save();
    ctx.font = `${axisFontSize}px Inter, sans-serif`;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim();
    ctx.textAlign = 'center';
    ctx.fillText('TPSA (\u00C5\u00B2)', padLeft + plotW / 2, H - (isCompact ? 2 : 8));
    ctx.save();
    ctx.translate(isCompact ? 10 : 14, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('WLogP', 0, 0);
    ctx.restore();
    ctx.restore();

    // Tick labels (outside clip)
    ctx.font = `${tickFontSize}px Inter, sans-serif`;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = xTickStart; x <= xMax; x += xTickStep) {
      const [px] = toPixel(x, 0);
      if (px >= padLeft - 5 && px <= W - padRight + 5) {
        const label = xTickStep >= 1 ? String(Math.round(x)) : x.toFixed(1);
        ctx.fillText(label, px, H - padBottom + 4);
      }
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = yTickStart; y <= yMax; y += yTickStep) {
      const [, py] = toPixel(0, y);
      if (py >= padTop - 5 && py <= H - padBottom + 5) {
        const label = yTickStep >= 1 ? String(Math.round(y)) : y.toFixed(1);
        ctx.fillText(label, padLeft - 4, py);
      }
    }

  }, [molecules, selectedMolIdx, fdaData, themeVersion, zoom, panX, panY]);

  // Redraw when data or container size changes
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas, containerSize, themeVersion]);

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom(z => {
        const next = Math.min(20, Math.max(1, z * factor));
        // If zooming back to ~1, snap to exactly 1 and reset pan
        if (next <= 1.02) { setPanX(0); setPanY(0); return 1; }
        return next;
      });
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  // ── Mouse drag to pan ───────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, [zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const baseXRange = 165; // baseXMax - baseXMin
    const baseYRange = 11;  // baseYMax - baseYMin
    const plotW = rect.width - 75; // approximate
    const plotH = rect.height - 70;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    // Convert pixel delta to data-space delta
    const dataDx = -(dx / plotW) * (baseXRange / zoom);
    const dataDy = (dy / plotH) * (baseYRange / zoom);
    setPanX(px => px + dataDx);
    setPanY(py => py + dataDy);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [zoom]);

  const handleMouseUp = useCallback(() => { isDragging.current = false; }, []);

  // ── Touch pinch-to-zoom + drag ──────────────────────────────────────────
  const lastTouchDist = useRef(0);
  const lastTouchCenter = useRef({ x: 0, y: 0 });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.hypot(dx, dy);
      lastTouchCenter.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    } else if (e.touches.length === 1 && zoom > 1) {
      isDragging.current = true;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, [zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastTouchDist.current > 0) {
        const factor = dist / lastTouchDist.current;
        setZoom(z => Math.min(20, Math.max(1, z * factor)));
      }
      lastTouchDist.current = dist;
    } else if (e.touches.length === 1 && isDragging.current && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const baseXRange = 165;
      const baseYRange = 11;
      const plotW = rect.width - 75;
      const plotH = rect.height - 70;
      const ddx = e.touches[0].clientX - lastMouse.current.x;
      const ddy = e.touches[0].clientY - lastMouse.current.y;
      setPanX(px => px - (ddx / plotW) * (baseXRange / zoom));
      setPanY(py => py + (ddy / plotH) * (baseYRange / zoom));
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, [zoom]);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
    lastTouchDist.current = 0;
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!containerRef.current || !setSelectedMolIdx) return;
    // Don't select if we just finished dragging
    if (isDragging.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isCompact = rect.width < 400;
    const hitR = isCompact ? 14 : 12;
    const hit = molPositionsRef.current.find(p => Math.hypot(p.x - x, p.y - y) < hitR);
    setSelectedMolIdx(hit ? hit.idx : null);
  }, [setSelectedMolIdx]);

  // Double-click to reset
  const handleDoubleClick = useCallback(() => { resetView(); }, [resetView]);

  // Count molecules in each region for the legend
  const regionCounts = molecules.reduce(
    (acc, m) => {
      const tpsa = m.props.TPSA;
      const wlogp = m.props.LogP;
      const inYolk = pointInPolygonSimple(tpsa, wlogp, BBB_COORDS);
      const inWhite = pointInPolygonSimple(tpsa, wlogp, GIA_COORDS);
      if (inYolk) acc.bbb++;
      else if (inWhite) acc.gia++;
      else acc.outside++;
      return acc;
    },
    { gia: 0, bbb: 0, outside: 0 }
  );

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-3 sm:p-4 md:p-5">
      <div className="mb-3 sm:mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-[13px] sm:text-[14px] font-medium text-[var(--text-heading)]">BOILED-Egg Plot</h3>
          <p className="text-[11px] sm:text-[12px] text-[var(--text2)] hidden sm:block">Brain Or Intestinal EstimateD permeation — Daina & Zoete, ChemMedChem 2016</p>
        </div>
        {isZoomed && (
          <button
            onClick={resetView}
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border-5)] text-[var(--text2)] hover:text-[var(--text-heading)] hover:border-[var(--accent)] transition-colors flex-shrink-0"
            title="Reset zoom (or double-click)"
          >
            Reset zoom
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:gap-4 text-[11px] sm:text-[12px] text-[var(--text2)] mb-3 sm:mb-4">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-white/80 border border-[#aaa]"></span>
          <span>GI absorbed</span>
          <span className="text-[var(--accent)] font-medium">({regionCounts.gia})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#ffdc50]/80 border border-[#cca000]"></span>
          <span>BBB</span>
          <span className="text-[var(--accent)] font-medium">({regionCounts.bbb})</span>
        </div>
        {regionCounts.outside > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#c8c8c8]/40 border border-[#555]"></span>
            <span>Outside</span>
            <span className="text-[var(--text2)]/60">({regionCounts.outside})</span>
          </div>
        )}
        {fdaData && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#6b7280]/60"></span>
            <span>FDA ref ({fdaData.length})</span>
          </div>
        )}
      </div>

      {/* Zoom hint */}
      {!isZoomed && molecules.length > 20 && (
        <p className="text-[10px] text-[var(--text2)]/50 mb-2">Scroll to zoom, drag to pan. Double-click to reset.</p>
      )}

      {/* Responsive canvas container */}
      <div
        ref={containerRef}
        className="w-full aspect-[4/3] sm:aspect-[16/10] md:aspect-[16/9] min-h-[240px] max-h-[600px] relative rounded-md overflow-hidden bg-[var(--bg)]"
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          style={{ cursor: zoom > 1 ? 'grab' : 'pointer', touchAction: 'none' }}
          onClick={handleCanvasClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>

      {/* Collapsible explainer */}
      <div className="mt-3 sm:mt-4">
        <button
          onClick={() => setShowExplainer(v => !v)}
          className="flex items-center gap-1.5 text-[11px] text-[var(--text2)]/70 hover:text-[var(--text2)] transition-colors"
        >
          <span className={`transition-transform ${showExplainer ? 'rotate-90' : ''}`}>&rsaquo;</span>
          <span>How to read this plot</span>
        </button>
        {showExplainer && (
          <p className="mt-2 text-[11px] text-[var(--text2)] leading-relaxed pl-4">
            The BOILED-Egg model uses WLOGP (Wildman-Crippen LogP) and TPSA to predict passive gastrointestinal absorption (white region) and blood-brain barrier penetration (yellow yolk). Molecules in the white are predicted to be absorbed by the GI tract. Molecules in the yolk are predicted to also cross the BBB. Scroll to zoom in on dense regions; drag to pan when zoomed.
          </p>
        )}
      </div>
    </div>
  );
}

/** Compute a "nice" tick step for n desired ticks over a range */
function niceStep(range: number, targetTicks: number): number {
  const rough = range / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * pow;
}

/** Simple point-in-polygon (for legend counts, outside render loop) */
function pointInPolygonSimple(tpsa: number, wlogp: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > wlogp) !== (yj > wlogp)) && (tpsa < (xj - xi) * (wlogp - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export default React.memo(EggView);
