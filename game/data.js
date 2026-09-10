// Board catalogue. Two boards share one rule shape; `setBoard` swaps the live
// exports so the engine and renderer pick up the chosen set.
const RENT_MULT = [1, 5, 15, 43, 58, 72];

function prop(groups, name, group, price) {
  const base = Math.max(2, Math.round(price / 12 / 2) * 2);
  return {
    kind: 'property', name, group, price,
    rent: RENT_MULT.map(m => Math.round(base * m / 2) * 2),
    houseCost: groups[group].houseCost,
  };
}

/* A card never says what it *is*, only what it does. The motif, the ink and the
   clip the piece acts out all fall out of the effect fields, so one rule here
   keeps the gallery preview, the popup and the board reaction in agreement
   instead of drifting apart the way three separate copies did.
   `act` is deliberately outside the cascade: the picture describes what the card
   does, not what the character does about it, so 劈崩人哋把刀 still reads as a
   bill. It only overrides the clip. */
const FLAVOURS = {
  queue:      { clip: 'sit',       tone: 'warn'   },
  openStall:  { clip: 'sprint',    tone: 'good'   },
  errand:     { clip: 'sprint',    tone: 'travel' },   // a trip is neither good nor bad
  wrongTurn:  { clip: 'sprint',    tone: 'warn'   },
  inspection: { clip: 'pick-up',   tone: 'bad'    },
  windfall:   { clip: 'emote-yes', tone: 'good'   },
  bill:       { clip: 'emote-no',  tone: 'bad'    },
  notice:     { clip: 'emote-no',  tone: 'travel' },   // unreachable: every card does something
};

export function cardFlavour(card) {
  // Order matters twice over: a jail card carries no `move`, and `move: 0` is a
  // real tile, so presence has to be tested rather than truth.
  const id = card.jail ? 'queue'
    : card.move === 0 ? 'openStall'
    : card.move !== undefined ? 'errand'
    : card.back ? 'wrongTurn'
    : card.repairs ? 'inspection'
    : (card.cash || 0) > 0 ? 'windfall'
    : (card.cash || 0) < 0 ? 'bill'
    : 'notice';
  const f = FLAVOURS[id];
  return { id, clip: card.act || f.clip, tone: f.tone, authored: !!card.act };
}

/* ---------------- 怡保美食 (Ipoh local food) ----------------
   摊位与老字号名称取自公开的怡保美食报导。每一组都是怡保真实的街道或社区，
   组内的每一档都确实开在那条街上 —— 换名时请连地点一起核对，不要只挑好听的菜名。*/
const IPOH_GROUPS = [
  { name: '兵如港', color: 0x9c6b42, houseCost: 50 },
  { name: '万里望', color: 0xd9b23c, houseCost: 50 },
  { name: '昆仑喇叭', color: 0xd97a3c, houseCost: 100 },
  { name: '休罗街', color: 0x74a83f, houseCost: 100 },
  { name: '姚德胜街', color: 0xd44f6e, houseCost: 150 },
  { name: '梁燊南街', color: 0x4a9bb5 , houseCost: 150 },
  { name: '戏院街', color: 0x8a63c4, houseCost: 200 },
  { name: '旧街场', color: 0x2f4858, houseCost: 200 },
];

const ipoh = {
  id: 'ipoh', name: '怡保美食', blurb: '一张桌、一碗河粉、一杯白咖啡。排队是本地传统。',
  currency: 'RM', groups: IPOH_GROUPS,
  labels: {
    start: '开市·饮早茶', jail: '排长龙', rest: '茶室歇脚',
    chance: '食神话你知', ledger: '肚腩快报',
    house: '一张桌', houses: '张桌', hotel: '分店',
    jailLine: '被人潮困在队伍里。',
    jailDetail: '排三轮，或掷出对子插队成功。',
    startDetail: '开市红包，照收。',
    taxDetail: '交给市政局，不必问收据。',
    restLine: '在茶室歇脚，叫了杯白咖啡。',
    visitLine: '经过长龙，看一眼就走。',
    winLine: '吃遍全怡保',
    winSub: '其他人都已经吃到破产。',
    buildHint: '同色摊位全买下，才能加桌，再开分店。',
    buyDetail: '摊位待顶。要不要接手？',
    newsTitle: '街头消息',
    ui: {
      forSale: '待顶', paymentDue: '要付钱', moneyIn: '进帐', headsUp: '注意',
      card: '抽卡', buyFor: n => '顶下 ' + n, pay: n => '付 ' + n,
      collect: n => '收 ' + n, understood: '知道了', no: '不要',
      botBuys: n => '电脑顶下了，' + n + '。', botPasses: '电脑不要。',
      passing: n => '路过' + n, landedOn: n => '走到' + n,
      rentAt: n => n + ' 的桌租', paidTo: n => '付给 ' + n, rentFlow: '桌租',
      folded: n => n + ' 吃到破产', foldedDetail: '摊位全数归还。',
      noPay: '没钱发了', noPayDetail: '快打模式：开市不再派钱。',
      unstuckTitle: '局面卡住了', unstuckDetail: '这一轮重新开始。',
      logFreed: n => n + ' 掷出对子，插队成功。',
      logFee: (n, f) => n + ' 付了 ' + f + '，下一轮才能走。',
      logStays: (n, t) => n + ' 还在排队（剩 ' + t + ' 轮）。',
      logPass: (n, c) => n + ' 路过开市，领 ' + c + '。',
      logDry: n => n + ' 路过开市，红包已经派完。',
      logBroke: (n, t) => n + ' 顶不起 ' + t + '。',
      logRent: (n, c, o, t) => n + ' 在 ' + t + ' 付了 ' + c + ' 给 ' + o + '。',
      logOwn: (n, t) => n + ' 坐在自己的 ' + t + '。',
      logTax: (t, n, c) => t + '：' + n + ' 付 ' + c + '。',
      logLand: (n, c) => n + ' 走到开市，领 ' + c + '。',
      logLandDry: n => n + ' 走到开市，什么都没领到。',
      logBuys: (n, t, c) => n + ' 顶下 ' + t + '，' + c + '。',
      logDeclines: (n, t) => n + ' 不要 ' + t + '。',
      logBuilds: (n, h, t) => n + ' 在 ' + t + ' ' + (h === '分店' ? '开了分店' : '加了' + h) + '。',
      logSells: (n, t) => n + ' 卖掉 ' + t + ' 的一张桌。',
      logOut: n => n + ' 吃到破产，退出。',
      logDoubles: n => n + ' 掷出对子，再来一轮。',
      roll: '掷骰', rolling: '掷…', rolled: '掷过了', bot: '电脑', endTurn: '换人', camera: '镜头', build: '加桌',
      roadAhead: '前面十格', newGame: '再来一局',
      baseRent: '基本租金', fullSet: '（整组 ×2）',
      withHouses: n => '加' + n + '张桌', withHotel: '开分店',
      unclaimed: '未顶', heldBy: n => n + ' 的摊', buildCost: '加桌费',
      transit: '夜市·美食中心', utility: '公共', close: '关掉',
      nHeld: n => '持 ' + n + ' 个', oneHeld: '持一个', bothHeld: '持两个',
      deedCount: n => n + ' 个摊', inJail: '排队中',
      nowPlaying: '现在轮到', onTile: '在', changeBoard: '换张板',
      waitingFor: n => '等紧 ' + n + '…',
      buildTitle: '加桌 — 同色收齐才行',
      roadFrom: n => '从 ' + n + ' 起', roadCount: n => '只看到 ' + n + ' 格',
      landToBuy: '走到这格才能顶。', empty: '空桌', restart: '再来一局',
      follow: '跟随', overview: '全景', victory: '封神', rapid: '快打',
      startCash: n => '本钱 ' + n, turnOf: '轮到', total: '合共',
      tabPlayers: '玩家', tabRoad: '前面十格', tabLog: '消息',
      tileStart: '领 RM200', tileJail: '路过看看', tileRest: '歇一歇', tileGoJail: '直接去排队',
      tilePay: '付 ',
      sell: '卖桌', cancel: '再想想', built: '加桌了', opened: '开分店', sold: '卖桌了',
      buildFor: n => '加桌 · ' + n, sellFor: n => '卖掉 · 收 ' + n,
      cashAfter: n => '之后剩 ' + n,
    },
  },
  centre: 'skyline',
  tiles: g => [
    { kind: 'start', name: '开市·饮早茶' },
    prop(g, '忠记大树脚', 0, 60),
    { kind: 'ledger', name: '肚腩快报' },
    prop(g, '德嫂猪肠粉', 0, 60),
    { kind: 'tax', name: '泊车牛肉干', amount: 200 },
    { kind: 'pier', name: '新街场夜市', price: 200 },
    prop(g, '银燕花生厂', 1, 100),
    { kind: 'chance', name: '食神话你知' },
    prop(g, '万里望为食街', 1, 100),
    prop(g, '财安园海南包', 1, 120),
    { kind: 'jail', name: '排长龙' },
    prop(g, '余合饼家', 2, 140),
    { kind: 'works', name: '石灰山泉水', price: 150 },
    prop(g, '福德祠叻沙', 2, 140),
    prop(g, '康记猪肠粉', 2, 160),
    { kind: 'pier', name: '糖水街', price: 200 },
    prop(g, '新泉芳咖喱面', 3, 180),
    { kind: 'ledger', name: '肚腩快报' },
    prop(g, '巴黎客家面', 3, 180),
    prop(g, '洪记饭店', 3, 200),
    { kind: 'rest', name: '茶室歇脚' },
    prop(g, '老黄芽菜鸡', 4, 220),
    { kind: 'chance', name: '食神话你知' },
    prop(g, '安记芽菜鸡', 4, 220),
    prop(g, '德记月光河', 4, 240),
    { kind: 'pier', name: '体育馆美食中心', price: 200 },
    prop(g, '富山茶楼', 5, 260),
    prop(g, '明阁点心', 5, 260),
    { kind: 'works', name: '炭烧咖啡厂', price: 150 },
    prop(g, '王福满点心', 5, 280),
    { kind: 'gotojail', name: '被叫去排队' },
    prop(g, '宴琼林盐焗鸡', 6, 300),
    prop(g, '奇峰豆腐花', 6, 300),
    { kind: 'ledger', name: '肚腩快报' },
    prop(g, '文冬口茶室', 6, 320),
    { kind: 'pier', name: '怡保花园夜市', price: 200 },
    { kind: 'chance', name: '食神话你知' },
    prop(g, '南香茶餐室', 7, 350),
    { kind: 'tax', name: '咖啡钱', amount: 100 },
    prop(g, '天津茶室', 7, 400),
  ],
  /* 卡片规矩：TVB 金句系「点解要去」嘅原因，唔系装饰。冇金句嗰阵，
     场景本身要交代到笔钱点解会郁 —— 整烂咗所以要赔，慳到所以袋落袋。
     一句讲唔出点解收/畀嘅卡，就系写错咗。*/
  chance: [
    { text: '一家人最紧要齐齐整整。返去开市格饮返餐晨早茶，顺手领 RM200。', move: 0 },
    { text: '你张鸡丝河粉相畀人转发咗一晚，第二日排队排到出街口。收 RM150。', cash: 150 },
    { text: '发生咁嘅事，大家都唔想嘅——张张枱都摇到食客投诉。每张枱 RM25，每间分店 RM100。', repairs: [25, 100] },
    { text: '人生有几多个十年，讲咗咁耐话要试天津嘅焦糖炖蛋。今次去埋佢。前往天津茶室。', move: 39 },
    { text: '你打尖插队，畀后面阿婆嗌到成条街都听到，老板叫你由头排过。去排长龙。', jail: true },
    { text: '你跟 GPS 转错入单程路，兜返出去嘥咗十分钟。退后三格。', back: 3 },
    { text: '旅游杂志影你个档做封面，唔使你出一毫子宣传费。收 RM100。', cash: 100 },
    { text: '有人叫你打包三十盒，走青走辣走鸡，盒仔全部你贴。畀 RM75。', cash: -75 },
    { text: '你去休罗街搵富山饮茶，先知人哋几十年前搬咗去梁燊南街。前往富山茶楼。', move: 26 },
    { text: '阿妈打嚟：你饿唔饿？顺路买盒香饼返嚟。前往余合饼家。', move: 11 },
    { text: '你徒手劈椰青，劈崩咗人哋把刀。赔 RM20。', cash: -20, act: 'attack-melee-right' },
    { text: '做人呢，最紧要开心。唔谂咁多，去糖水街饮碗糖水先。前往糖水街。', move: 15 },
    { text: '茶室把风扇卡死，你一脚踢返生，老板即刻请你食碗面。慳返 RM60。', cash: 60, act: 'attack-kick-right' },
    { text: '你喺奇峰 drive-through 入咗二十杯豆浆，返档口转卖。赚 RM40。', cash: 40, act: 'interact-right' },
    { text: '你入淡汶香饼时睇到盒底写住昆仑喇叭出品，索性直接同厂入货。慳 RM40。', cash: 40 },
    { text: '你同人拗怡保啲水靓所以芽菜靓，拗输咗，一围人杯茶你找。畀 RM50。', cash: -50 },
  ],
  ledger: [
    { text: '你还返啲玻璃杯同箩，攞返按金 RM50。', cash: 50 },
    { text: '姑妈见你成日一个人食饭，塞咗 RM100 落你袋叫你补返身子。收 RM100。', cash: 100 },
    { text: '摊位牌照到期，市政局照收唔误。畀 RM50。', cash: -50 },
    { text: '供应商追住你解释：你听我讲，佢多收咗你一季芽菜钱。退返 RM200。', cash: 200 },
    { text: '你逞强叫特辣，第二朝去诊所报到。畀 RM50。', cash: -50 },
    { text: '卫生局突击检查，油烟槽唔合格。每张枱 RM40，每间分店 RM115。', repairs: [40, 115] },
    { text: '你霸咗张枱两个钟，净系饮一杯白咖啡。老板请你去后面排队。去排长龙。', jail: true },
    { text: '你排到埋去，老板话：我哋已经尽咗力，今日真系卖晒。返去开市格重新嗌过。', move: 0 },
    { text: '柴油津贴终于批落嚟，补返你三个月。收 RM75。', cash: 75 },
    { text: '你一时豪爽话今日我请，全枱即刻加叻沙加烧肉。畀 RM100。', cash: -100 },
    { text: '你挥苍蝇拍扫跌咗人哋碗猪肠粉，赔返一碗。畀 RM30。', cash: -30, act: 'attack-melee-left' },
    { text: '泊车闸门卡死，你踢咗一脚佢开返，管理员免咗你今日泊车费。收 RM80。', cash: 80, act: 'attack-kick-left' },
    { text: '你冚咗成杯白咖啡落人哋条裤，佢一句你从来都冇理过我嘅感受。赔干洗费 RM45。', cash: -45, act: 'emote-no' },
    { text: '你上石灰山担咗几桶山水返嚟浸粉，慳返成个月水费。收 RM60。', cash: 60, act: 'pick-up' },
    { text: '你泊咗喺黄线度，咖啡未饮完已经收咗张牛肉干。畀 RM40。', cash: -40 },
    { text: '客人问你万里望花生系咪万里望种，你照实讲唔系，佢仲要多买两包。收 RM25。', cash: 25 },
  ],
};

/* ---------------- Jalan Malaysia ---------------- */
const MY_GROUPS = [
  { name: 'Melaka', color: 0x9b5fb0, houseCost: 50 },
  { name: 'Ipoh', color: 0x63b8dd, houseCost: 50 },
  { name: 'Penang', color: 0xe08a3c, houseCost: 100 },
  { name: 'Johor', color: 0xd44a4a, houseCost: 100 },
  { name: 'Langkawi', color: 0xe8b93a, houseCost: 150 },
  { name: 'Sabah & Sarawak', color: 0x3fa06a, houseCost: 150 },
  { name: 'Tanah Tinggi', color: 0x3f74c4, houseCost: 200 },
  { name: 'Kuala Lumpur', color: 0x27354f, houseCost: 200 },
];

const malaysia = {
  id: 'malaysia', name: 'Jalan Malaysia', blurb: 'Kampung to KLCC — states, highlands and night markets.',
  currency: 'RM', groups: MY_GROUPS,
  labels: {
    start: 'Mula', jail: 'Balai Polis', rest: 'Pasar Malam',
    chance: 'Rezeki', ledger: 'Peti Surat',
    house: 'rumah', houses: 'rumah', hotel: 'hotel',
    jailLine: 'is sent to the Balai Polis.',
    jailDetail: 'Three turns, or roll doubles to leave early.',
    startDetail: 'Salary collected at Mula.',
    taxDetail: 'Paid to the Lembaga Hasil.',
    restLine: 'stops for supper at the Pasar Malam.',
    visitLine: 'is just visiting the Balai Polis.',
    winLine: 'owns the whole jalan',
    winSub: 'Every other player has folded.',
    buildHint: 'Own every lot in a colour set to build rumah, then a hotel.',
    buyDetail: 'Unclaimed. Take the lot now, or leave it on the market.',
    newsTitle: 'Berita',
  },
  centre: 'tower',
  tiles: g => [
    { kind: 'start', name: 'Mula' },
    prop(g, 'Jonker Street', 0, 60),
    { kind: 'ledger', name: 'Peti Surat' },
    prop(g, 'Stadthuys', 0, 60),
    { kind: 'tax', name: 'Cukai Pendapatan', amount: 200 },
    { kind: 'pier', name: 'KLIA', price: 200 },
    prop(g, 'Kellie’s Castle', 1, 100),
    { kind: 'chance', name: 'Rezeki' },
    prop(g, 'Gunung Lang', 1, 100),
    prop(g, 'Kek Lok Tong', 1, 120),
    { kind: 'jail', name: 'Balai Polis' },
    prop(g, 'Gurney Drive', 2, 140),
    { kind: 'works', name: 'Tenaga Nasional', price: 150 },
    prop(g, 'Armenian Street', 2, 140),
    prop(g, 'Batu Ferringhi', 2, 160),
    { kind: 'pier', name: 'Penang Airport', price: 200 },
    prop(g, 'Danga Bay', 3, 180),
    { kind: 'ledger', name: 'Peti Surat' },
    prop(g, 'Jalan Tan Hiok Nee', 3, 180),
    prop(g, 'Puteri Harbour', 3, 200),
    { kind: 'rest', name: 'Pasar Malam' },
    prop(g, 'Pantai Cenang', 4, 220),
    { kind: 'chance', name: 'Rezeki' },
    prop(g, 'Kuah Town', 4, 220),
    prop(g, 'Sky Bridge', 4, 240),
    { kind: 'pier', name: 'Kota Kinabalu Airport', price: 200 },
    prop(g, 'Kota Kinabalu', 5, 260),
    prop(g, 'Kuching Waterfront', 5, 260),
    { kind: 'works', name: 'Air Selangor', price: 150 },
    prop(g, 'Mulu Caves', 5, 280),
    { kind: 'gotojail', name: 'Pergi ke Balai' },
    prop(g, 'Fraser’s Hill', 6, 300),
    prop(g, 'Cameron Highlands', 6, 300),
    { kind: 'ledger', name: 'Peti Surat' },
    prop(g, 'Genting Highlands', 6, 320),
    { kind: 'pier', name: 'Kuching Airport', price: 200 },
    { kind: 'chance', name: 'Rezeki' },
    prop(g, 'Bukit Bintang', 7, 350),
    { kind: 'tax', name: 'Cukai Perkhidmatan', amount: 100 },
    prop(g, 'KLCC', 7, 400),
  ],
  chance: [
    { text: 'Balik kampung. Move to Mula and collect RM200.', move: 0 },
    { text: 'Durian season windfall: collect RM150.', cash: 150 },
    { text: 'Monsoon repairs: pay RM25 per rumah, RM100 per hotel.', repairs: [25, 100] },
    { text: 'Penthouse viewing at KLCC. Advance there.', move: 39 },
    { text: 'Saman tak bayar. Go to the Balai Polis.', jail: true },
    { text: 'Wrong exit on the highway. Back three tiles.', back: 3 },
    { text: 'Toll rebate: collect RM100.', cash: 100 },
    { text: 'Parking summons: pay RM75.', cash: -75 },
    { text: 'Flight from Penang Airport. Advance there.', move: 15 },
    { text: 'Supper at Gurney Drive. Advance there.', move: 11 },
    { text: "You attack a coconut with your bare hands. It wins: pay RM20.", cash: -20, act: 'attack-melee-right' },
    { text: "One well-aimed kick fixes the kedai fan. Free supper: collect RM60.", cash: 60, act: 'attack-kick-right' },
  ],
  ledger: [
    { text: 'Duit raya from the family: collect RM50.', cash: 50 },
    { text: 'ASB dividend: collect RM100.', cash: 100 },
    { text: 'Road tax and insurance: pay RM50.', cash: -50 },
    { text: 'Tax refund from Hasil: collect RM200.', cash: 200 },
    { text: 'Clinic visit: pay RM50.', cash: -50 },
    { text: 'Renovation quit rent: pay RM40 per rumah, RM115 per hotel.', repairs: [40, 115] },
    { text: 'Roadblock, papers not in order. Go to the Balai Polis.', jail: true },
    { text: 'Return to Mula.', move: 0 },
    { text: 'Kenduri contribution returned: collect RM75.', cash: 75 },
    { text: 'School fees for the year: pay RM100.', cash: -100 },
    { text: "You swat at a mosquito for nine minutes and lose: pay RM30.", cash: -30, act: 'attack-melee-left' },
    { text: "You kick the parking gate. It opens. Nobody charges you: collect RM80.", cash: 80, act: 'attack-kick-left' },
  ],
};

/* ---------------- Hustle City (satire board) ---------------- */
const HUS_GROUPS = [
  { name: 'Starter Flats', color: 0x9a8f86, houseCost: 50 },
  { name: 'Gig Economy', color: 0x6fb7dd, houseCost: 50 },
  { name: 'Open Plan', color: 0xe2803c, houseCost: 100 },
  { name: 'Wellness', color: 0x74c05a, houseCost: 100 },
  { name: 'Startupland', color: 0xe3b731, houseCost: 150 },
  { name: 'The Suburbs', color: 0x54a465, houseCost: 150 },
  { name: 'Crypto', color: 0x8a63c4, houseCost: 200 },
  { name: 'Old Money', color: 0x2d3c58, houseCost: 200 },
];

const hustle = {
  id: 'hustle', name: 'Hustle City', blurb: 'Rise and grind. Mostly grind. Rents are due Monday.',
  currency: '$', groups: HUS_GROUPS,
  labels: {
    start: 'Monday', jail: 'HR Mediation', rest: 'Lunch Break',
    chance: 'Vibes', ledger: 'Fine Print',
    house: 'a pod', houses: 'pods', hotel: 'a headquarters',
    jailLine: 'has been invited to a conversation with HR.',
    jailDetail: 'Three turns of mandatory reflection, or roll doubles to be reassigned.',
    startDetail: 'Payroll cleared, somehow.',
    taxDetail: 'Non-refundable. Obviously.',
    restLine: 'takes a full lunch break. Nobody notices.',
    visitLine: 'walks past HR without making eye contact.',
    winLine: 'wins the entire economy',
    winSub: 'Everyone else is pivoting to consulting.',
    buildHint: 'Own a whole colour set to build pods, then a headquarters nobody asked for.',
    buyDetail: 'On the market. Bold move either way.',
    newsTitle: 'The group chat',
  },
  centre: 'tower',
  tiles: g => [
    { kind: 'start', name: 'Monday' },
    prop(g, 'Windowless Studio', 0, 60),
    { kind: 'ledger', name: 'Fine Print' },
    prop(g, 'Convertible Sofa', 0, 60),
    { kind: 'tax', name: 'Convenience Fee', amount: 200 },
    { kind: 'pier', name: 'Replacement Bus', price: 200 },
    prop(g, 'Surge Pricing Zone', 1, 100),
    { kind: 'chance', name: 'Vibes' },
    prop(g, 'Five-Star Rating', 1, 100),
    prop(g, 'Unpaid Internship', 1, 120),
    { kind: 'jail', name: 'HR Mediation' },
    prop(g, 'Hot Desk', 2, 140),
    { kind: 'works', name: 'The Printer', price: 150 },
    prop(g, 'Standing Desk', 2, 140),
    prop(g, 'Glass Meeting Box', 2, 160),
    { kind: 'pier', name: 'Delayed Flight', price: 200 },
    prop(g, 'Mandatory Fun', 3, 180),
    { kind: 'ledger', name: 'Fine Print' },
    prop(g, 'Mindfulness App', 3, 180),
    prop(g, 'Ergonomic Chair', 3, 200),
    { kind: 'rest', name: 'Lunch Break' },
    prop(g, 'Series A', 4, 220),
    { kind: 'chance', name: 'Vibes' },
    prop(g, 'The Pivot', 4, 220),
    prop(g, 'Disruptive Kombucha', 4, 240),
    { kind: 'pier', name: 'Rescheduled Train', price: 200 },
    prop(g, 'Cul-de-Sac', 5, 260),
    prop(g, 'Two-Car Garage', 5, 260),
    { kind: 'works', name: 'The Group Chat', price: 150 },
    prop(g, 'Lawn of Judgement', 5, 280),
    { kind: 'gotojail', name: 'Referred to HR' },
    prop(g, 'Definitely Not a Scam', 6, 300),
    prop(g, 'To The Moon', 6, 300),
    { kind: 'ledger', name: 'Fine Print' },
    prop(g, 'Diamond Hands', 6, 320),
    { kind: 'pier', name: 'Overbooked Ferry', price: 200 },
    { kind: 'chance', name: 'Vibes' },
    prop(g, 'The Family Trust', 7, 350),
    { kind: 'tax', name: 'Legacy Admissions Fee', amount: 100 },
    prop(g, 'Generational Wealth', 7, 400),
  ],
  chance: [
    { text: 'It is Monday again. Go there and collect $200.', move: 0 },
    { text: 'You went viral for eleven minutes: collect $150.', cash: 150 },
    { text: 'Your pods need repainting: pay $25 each, $100 per headquarters.', repairs: [25, 100] },
    { text: 'You married into Generational Wealth. Advance there.', move: 39 },
    { text: 'Reply-all incident. Go to HR Mediation.', jail: true },
    { text: 'You misread the calendar invite. Back three tiles.', back: 3 },
    { text: 'Class-action settlement: collect $100.', cash: 100 },
    { text: 'Subscription you forgot to cancel: pay $75.', cash: -75 },
    { text: 'Your flight is delayed. Advance to Delayed Flight.', move: 15 },
    { text: 'Someone booked you a Hot Desk. Advance there.', move: 11 },
    { text: "You fight the printer. The printer is undefeated: pay $20.", cash: -20, act: 'attack-melee-right' },
    { text: "You kick the vending machine and two snacks fall out: collect $60.", cash: 60, act: 'attack-kick-right' },
  ],
  ledger: [
    { text: 'You returned the thing: collect $50.', cash: 50 },
    { text: 'An aunt believed in you: collect $100.', cash: 100 },
    { text: 'Annual subscription renews at a worse price: pay $50.', cash: -50 },
    { text: 'Clerical error in your favour. Say nothing. Collect $200.', cash: 200 },
    { text: 'Dentist. Pay $50 and do not skip flossing.', cash: -50 },
    { text: 'Surprise inspection: pay $40 per pod, $115 per headquarters.', repairs: [40, 115] },
    { text: 'Your badge no longer works. Go to HR Mediation.', jail: true },
    { text: 'Back to Monday.', move: 0 },
    { text: 'Expense report finally approved: collect $75.', cash: 75 },
    { text: 'You were volunteered for the offsite: pay $100.', cash: -100 },
    { text: "You punch the air during a standup. HR is notified: pay $30.", cash: -30, act: 'attack-melee-left' },
    { text: "You kick the server rack and the outage ends. Hero for a day: collect $80.", cash: 80, act: 'attack-kick-left' },
  ],
};

/* ---------------- Pirate Cove ----------------
   A cursed ship's company, plus three people who washed ashore and have not
   been told they are not getting home. */
const PIRATE_GROUPS = [
  { name: 'The Shallows',   color: 0x8a6a4a, houseCost: 50 },
  { name: 'Grog Quarter',   color: 0xc4913a, houseCost: 50 },
  { name: 'Rope & Tar',     color: 0xb5543f, houseCost: 100 },
  { name: 'The Mangroves',  color: 0x5f8f4a, houseCost: 100 },
  { name: 'Cursed Reefs',   color: 0x3f9a9a, houseCost: 150 },
  { name: 'Powder Row',     color: 0x7b5ea8, houseCost: 150 },
  { name: 'The Deep Berth', color: 0x3b6fa8, houseCost: 200 },
  { name: "Admiral's Bay",  color: 0x2f3d52, houseCost: 200 },
];

/* Same rig across every pack, so the whole crew animates. Five are dead, four
   signed on willingly, and three have no idea how they got here. */
const PIRATE_CAST = [
  { url: './assets/crew/graveyard/character-skeleton.glb', name: 'Cap’n Marrow', role: 'still in charge',   line: 'Died. Did not resign.' },
  { url: './assets/crew/graveyard/character-ghost.glb',    name: 'Old Pale',        role: 'navigator',          line: 'Walks through the chart room, and the chart' },
  { url: './assets/crew/graveyard/character-zombie.glb',   role: 'ship’s cook', name: 'Gristle',           line: 'Nobody asks what is in the stew' },
  { url: './assets/crew/graveyard/character-vampire.glb',  name: 'Count Bilge',     role: 'night watch',        line: 'Volunteered for every night watch. Every one.' },
  { url: './assets/crew/graveyard/character-keeper.glb',   name: 'The Keeper',      role: 'quartermaster',      line: 'Counts the shares twice, aloud, slowly' },
  { url: './assets/crew/dungeon/character-orc.glb',        name: 'Bosun Grud',      role: 'bosun',              line: 'Settles disputes by ending them' },
  { url: './assets/crew/dungeon/character-human.glb',      name: 'Honest Bev',      role: 'last honest sailor', line: 'Keeps a receipt for every barrel' },
  { url: './assets/crew/arena/character-soldier.glb',      name: 'Sgt. Pike',       role: 'changed sides',      line: 'The navy still sends letters' },
  { url: './assets/crew/forest/character-archer.glb',      name: 'Fen',             role: 'lookout',            line: 'Has never once shouted land' },
  { url: './assets/crew/skate/character-skate-girl.glb',   name: 'Rilla',           role: 'washed ashore',      line: 'Asked where the nearest ramp is' },
  { url: './assets/crew/arcade/character-gamer.glb',       name: 'Pixel',           role: 'washed ashore',      line: 'Keeps asking where the save point is' },
  { url: './assets/crew/market/character-employee.glb',    name: 'Trainee Dev',     role: 'still on contract',  line: 'Believes this counts as a work trip' },
];

const pirates = {
  id: 'pirates', name: 'Pirate Cove', blurb: 'A cursed crew, a sinking market, and rent due at high tide.',
  currency: '¤', groups: PIRATE_GROUPS, cast: PIRATE_CAST,
  build: {
    // the kit has no cottages — it is towers, walls and ships — so the ladder is
    // a stone watchpost growing into a full fort rather than huts into a hotel
    houses: ['./assets/pirate/tower-base.glb', './assets/pirate/tower-base-door.glb',
             './assets/pirate/tower-middle-windows.glb'],
    towers: ['./assets/pirate/tower-complete-large.glb', './assets/pirate/tower-complete-small.glb',
             './assets/pirate/tower-watch.glb', './assets/pirate/tower-complete-large.glb'],
    props: ['./assets/pirate/ship-wreck.glb', './assets/pirate/rocks-sand-a.glb',
            './assets/pirate/rocks-sand-b.glb', './assets/pirate/palm-detailed-straight.glb',
            './assets/pirate/palm-detailed-bend.glb', './assets/pirate/barrel.glb',
            './assets/pirate/chest.glb'],
  },
  labels: {
    start: 'High Tide', jail: 'The Brig', rest: 'Shore Leave',
    chance: 'Ill Winds', ledger: "Ship's Books",
    house: 'a watchpost', houses: 'watchposts', hotel: 'a fort',
    jailLine: 'is in the brig, thinking about it.',
    jailDetail: 'Three turns, or roll doubles and squeeze through the bars.',
    startDetail: 'The tide came in. So did your share.',
    taxDetail: 'The harbourmaster does not negotiate.',
    restLine: 'takes shore leave and regrets it by morning.',
    visitLine: 'walks past the brig and waves at somebody inside.',
    winLine: 'owns the whole cove',
    winSub: 'The rest of the crew is bailing.',
    buildHint: 'Own every plot of one colour to raise watchposts, then a fort.',
    buyDetail: 'Unclaimed. Plant a flag or move along.',
    newsTitle: 'Dockside talk',
  },
  centre: 'wreck',
  tiles: g => [
    { kind: 'start', name: 'High Tide' },
    prop(g, 'Barnacle Steps', 0, 60),
    { kind: 'ledger', name: "Ship's Books" },
    prop(g, 'Wet Rope Landing', 0, 60),
    { kind: 'tax', name: 'Harbour Dues', amount: 200 },
    { kind: 'pier', name: 'The Leaky Ferry', price: 200 },
    prop(g, 'The Second Barrel', 1, 100),
    { kind: 'chance', name: 'Ill Winds' },
    prop(g, 'Two Fingers Tavern', 1, 100),
    prop(g, 'The Empty Keg', 1, 120),
    { kind: 'jail', name: 'The Brig' },
    prop(g, 'Tar Pit Row', 2, 140),
    { kind: 'works', name: 'The Bilge Pump', price: 150 },
    prop(g, 'Knot Street', 2, 140),
    prop(g, 'Sailmaker’s Loft', 2, 160),
    { kind: 'pier', name: 'The Slow Sloop', price: 200 },
    prop(g, 'Mosquito Flats', 3, 180),
    { kind: 'ledger', name: "Ship's Books" },
    prop(g, 'The Green Water', 3, 180),
    prop(g, 'Crocodile Crossing', 3, 200),
    { kind: 'rest', name: 'Shore Leave' },
    prop(g, 'Widow’s Reef', 4, 220),
    { kind: 'chance', name: 'Ill Winds' },
    prop(g, 'The Singing Rocks', 4, 220),
    prop(g, 'Bones Shoal', 4, 240),
    { kind: 'pier', name: 'The Borrowed Dinghy', price: 200 },
    prop(g, 'Powder Store', 5, 260),
    prop(g, 'The Short Fuse', 5, 260),
    { kind: 'works', name: 'The Rope Walk', price: 150 },
    prop(g, 'Cannon Yard', 5, 280),
    { kind: 'gotojail', name: 'Clapped In Irons' },
    prop(g, 'The Deep Berth', 6, 300),
    prop(g, 'Drowned Warehouse', 6, 300),
    { kind: 'ledger', name: "Ship's Books" },
    prop(g, 'The Black Jetty', 6, 320),
    { kind: 'pier', name: 'The Last Packet', price: 200 },
    { kind: 'chance', name: 'Ill Winds' },
    prop(g, 'Governor’s Stair', 7, 350),
    { kind: 'tax', name: 'Letter of Marque', amount: 100 },
    prop(g, 'Admiral’s Bay', 7, 400),
  ],
  chance: [
    { text: 'You face the Kraken! RUN! You reach High Tide. Collect ¤200.', move: 0 },
    { text: 'You find a treasure chest! It is full of sand. Collect ¤150.', cash: 150 },
    { text: 'A storm destroys your stuff. Pay ¤25 per watchpost, ¤100 per fort.', repairs: [25, 100] },
    { text: 'Zeus likes you today. Go to Admiral’s Bay.', move: 39 },
    { text: 'You steal from the crew. Zeus saw everything. Go to the brig.', jail: true },
    { text: 'Poseidon thinks you are Odysseus. He sends you back 3 tiles.', back: 3 },
    { text: 'Hermes gives you ¤100. He says it is yours. Take it and run.', cash: 100 },
    { text: 'Your parrot ate your map. Pay ¤75 for a new one.', cash: -75 },
    { text: 'The ship is leaving! RUN to The Slow Sloop.', move: 15 },
    { text: 'Hermes tells you to go to Tar Pit Row. You have no idea why. Go there.', move: 11 },
    { text: 'You punch a barrel. Your hand hurts. Pay ¤20.', cash: -20, act: 'attack-melee-right' },
    { text: 'You kick a box. Money falls out. Collect ¤60.', cash: 60, act: 'attack-kick-right' },
  ],
  ledger: [
    { text: 'Hermes gives you ¤50. He says it is yours. Keep it.', cash: 50 },
    { text: 'Your aunt sends you ¤100. She still believes in you.', cash: 100 },
    { text: 'The cook wants his pay. He is dead. Pay ¤50 anyway.', cash: -50 },
    { text: 'The boss made a mistake. You get ¤200. Keep quiet.', cash: 200 },
    { text: 'Apollo says you need more sunlight. You need limes instead. Pay ¤50.', cash: -50 },
    { text: 'Athena checks your buildings. She is not impressed. Pay ¤40 per watchpost, ¤115 per fort.', repairs: [40, 115] },
    { text: 'Zeus checks your papers. They are fake. Go to the brig.', jail: true },
    { text: 'Poseidon is angry again. Go back to High Tide.', move: 0 },
    { text: 'Hermes finally brings your money. Collect ¤75.', cash: 75 },
    { text: 'Hades needs someone to clean up. You got picked. Pay ¤100.', cash: -100 },
    { text: 'You punch a barrel. Your hand hurts. Pay ¤30.', cash: -30, act: 'attack-melee-left' },
    { text: 'You kick the pump. It works! You are a hero. Collect ¤80.', cash: 80, act: 'attack-kick-left' },
  ],
};

/* ---------------- casts ----------------
   A board may bring its own crew. Each entry carries its own model path, because
   Kenney ships one colormap per pack and the GLBs reference it relatively — so
   characters from different packs have to stay in their own folders. Every pack
   used here shares the same rig and the same clip names (idle, walk, jump,
   emote-yes, attack-kick-right …), which is what lets them mix at all. */

const MINI_CAST = Array.from({ length: 12 }, (_, i) => ({
  url: './assets/pieces/char-' + String(i + 1).padStart(2, '0') + '.glb',
}));
// names for the default cast live alongside the models they describe
const MINI_NAMES = [
  { name: '霞姐',   role: '茶室阿姐',   line: '一手抹桌，一手端茶' },
  { name: '阿德',   role: '打包大王',   line: '眼镜一戴，排队最快' },
  { name: '小敏',   role: '晨跑健将',   line: '五点半就绕完一圈' },
  { name: '光头炳', role: '炒粉师傅',   line: '锅气全靠这双手' },
  { name: '妮妮',   role: '背包学生',   line: '连帽一拉就去吃' },
  { name: '阿祥',   role: '交通警',     line: '这条街他说了算' },
  { name: '慧敏',   role: '写字楼会计', line: '每一分都算得清' },
  { name: '陈老板', role: '收租佬',     line: '西装笔挺，租金准时' },
  { name: '阿玲',   role: '夜班护士',   line: '下班第一站是夜市' },
  { name: '大雄',   role: '工地师傅',   line: '护目镜一戴就开工' },
  { name: '珍珍',   role: '观光客',     line: '背包塞满伴手礼' },
  { name: '阿豹',   role: '摩托快递',   line: '巷子窄他更快' },
];
export const DEFAULT_CAST = MINI_CAST.map((c, i) => ({ ...c, ...MINI_NAMES[i] }));

export const BOARDS = { ipoh, malaysia, hustle, pirates };

/* ---------------- live exports ---------------- */
export let BOARD = ipoh;
export let GROUPS = ipoh.groups.map((g, i) => ({ id: i, ...g }));
export let TILES = ipoh.tiles(GROUPS);
export let CHANCE = ipoh.chance;
export let LEDGER = ipoh.ledger;
export let LABELS = ipoh.labels;
export let CURRENCY = ipoh.currency;
export let CAST = DEFAULT_CAST;

export function setBoard(id) {
  const b = BOARDS[id] || ipoh;
  BOARD = b;
  GROUPS = b.groups.map((g, i) => ({ id: i, ...g }));
  TILES = b.tiles(GROUPS);
  CHANCE = b.chance;
  LEDGER = b.ledger;
  LABELS = b.labels;
  CURRENCY = b.currency;
  CAST = b.cast || DEFAULT_CAST;
  return b;
}

export const PIER_RENT = [25, 50, 100, 200];

export const PLAYER_COLORS = [
  { name: 'Coral', hex: 0xd6503e, css: '#d6503e' },
  { name: 'Cobalt', hex: 0x2f6f9e, css: '#2f6f9e' },
  { name: 'Saffron', hex: 0xd9a12a, css: '#d9a12a' },
  { name: 'Moss', hex: 0x4f8a55, css: '#4f8a55' },
];

export const START_CASH = 1500;        // standard
export const PASS_START = 200;
export const JAIL_FEE = 50;
export const JAIL_TILE = 10;
