// Illustrative fixtures only. These values are not dietary guidance or model output.
export const demoDate = '2026-09-18';
export const catalog = [
 { id: 'scramble', name: '炒鸡蛋', subtitle: '家常做法 · 用油量可能不同', category: '家常菜', kind: 'egg', amount: 100, unit: '克', energy: 180, protein: 12, carbs: 2, fat: 14, aliases: '鸡蛋', common: false },
 { id: 'potato', name: '烤土豆', subtitle: '切块 · 带皮', category: '主食', kind: 'potato', amount: 100, unit: '克', energy: 110, protein: 2, carbs: 22, fat: 2, aliases: '马铃薯 洋芋', common: false },
 { id: 'pineapple', name: '菠萝', subtitle: '切块鲜果', category: '水果', kind: 'pineapple', amount: 80, unit: '克', energy: 40, protein: .4, carbs: 10, fat: .1, aliases: '凤梨', common: false },
 { id: 'berries', name: '草莓与蓝莓', subtitle: '混合鲜果', category: '水果', kind: 'berries', amount: 80, unit: '克', energy: 35, protein: .5, carbs: 8, fat: .2, aliases: '草莓 蓝莓', common: false },
 { id: 'rice', name: '米饭', subtitle: '煮熟的白米饭', category: '主食', kind: 'rice', amount: 150, unit: '克', energy: 174, protein: 3.9, carbs: 38.9, fat: .5, aliases: '白饭 大米', common: true },
 { id: 'egg', name: '鸡蛋', subtitle: '水煮 · 普通大小', category: '肉蛋奶', kind: 'egg', amount: 2, unit: '个', energy: 144, protein: 12.6, carbs: .8, fat: 9.6, aliases: '水煮蛋 鸡子', common: true },
 { id: 'soy', name: '豆浆', subtitle: '无糖 · 一杯约 250 毫升', category: '饮品', kind: 'drink', amount: 250, unit: '毫升', energy: 80, protein: 7, carbs: 4.5, fat: 4, aliases: '豆奶 豆漿', common: true },
 { id: 'cabbage', name: '白菜', subtitle: '清炒 · 份量按熟菜估算', category: '蔬菜', kind: 'vegetable', amount: 150, unit: '克', energy: 70, protein: 2.2, carbs: 5, fat: 4.6, aliases: '大白菜 青菜 黄芽白', common: true },
 { id: 'chicken', name: '鸡胸肉', subtitle: '煎熟 · 去皮', category: '肉蛋奶', kind: 'chicken', amount: 120, unit: '克', energy: 198, protein: 37.2, carbs: 0, fat: 4.3, aliases: '鸡肉 雞胸', common: false },
 { id: 'broccoli', name: '西兰花', subtitle: '水煮或清蒸', category: '蔬菜', kind: 'broccoli', amount: 100, unit: '克', energy: 35, protein: 2.4, carbs: 7.2, fat: .4, aliases: '花椰菜 青花菜', common: false },
 { id: 'apple', name: '苹果', subtitle: '普通大小 · 去核食用', category: '水果', kind: 'fruit', amount: 1, unit: '个', energy: 95, protein: .5, carbs: 25, fat: .3, aliases: '蘋果', common: false },
 { id: 'bread', name: '全麦面包', subtitle: '切片 · 约 30 克／片', category: '主食', kind: 'bread', amount: 2, unit: '片', energy: 156, protein: 6, carbs: 28, fat: 2.4, aliases: '吐司 土司', common: true },
 { id: 'stirfry', name: '番茄炒蛋', subtitle: '家常做法 · 用油量可能不同', category: '家常菜', kind: 'egg', amount: 200, unit: '克', energy: 230, protein: 13, carbs: 12, fat: 14, aliases: '西红柿炒鸡蛋', common: false },
 { id: 'milk', name: '牛奶', subtitle: '原味全脂', category: '肉蛋奶', kind: 'drink', amount: 250, unit: '毫升', energy: 150, protein: 8, carbs: 12, fat: 8, aliases: '纯牛奶 奶', common: false },
];
export const copy = value => JSON.parse(JSON.stringify(value));
export const food = id => ({ ...copy(catalog.find(f => f.id === id)), key: crypto.randomUUID() });
export const initialMeals = () => [
 { id: 'lunch', name: '午餐', date: demoDate, time: '12:20', photo: '/assets/sample-lunch.png', items: [food('scramble'),food('potato'),food('broccoli'),food('pineapple'),food('berries')], status: 'ready', source: '照片估算', note: '' },
 { id: 'breakfast', name: '早餐', date: demoDate, time: '08:15', photo: null, items: [food('egg'),food('soy'),food('bread')], status: 'ready', source: '手动记录', note: '' },
 { id: 'yesterday', name: '晚餐', date: '2026-09-17', time: '18:40', photo: null, items: [food('cabbage'),food('rice'),food('stirfry')], status: 'ready', source: '手动记录', note: '' },
];
export const basePlan = [{ id:'squat', name:'深蹲', area:'下肢 · 自重', sets:3, reps:12, weight:0 },{ id:'row', name:'哑铃划船', area:'背部 · 哑铃', sets:3, reps:10, weight:10 },{ id:'press', name:'哑铃推举', area:'肩部 · 哑铃', sets:3, reps:10, weight:5 }];
