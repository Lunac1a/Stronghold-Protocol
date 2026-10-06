// Custom recruitable cards. Official character/skill data remains the source of combat numbers.
export const CUSTOM_OPERATORS = Object.freeze([
  { key: 'wang', charId: 'char_2027_wang', tier: 6, bond: 'yanShip', skillIndex: 2 },
  { key: 'chen3', charId: 'char_1050_chen3', tier: 5, bond: 'yanShip', skillIndex: 2 },
  { key: 'kalts2', charId: 'char_1052_kalts2', tier: 5, bond: 'emptyShip', skillIndex: 1 },
  { key: 'oblvns', charId: 'char_4182_oblvns', tier: 6, bond: 'emptyShip', skillIndex: 2 },
  { key: 'wisdel', charId: 'char_1035_wisdel', tier: 5, bond: 'emptyShip', skillIndex: 2 },
]);

// The Protocol releases skills automatically; original manual-stop descriptions
// must not advertise an interaction that is unavailable during these battles.
export function adaptCustomSkillDescriptions(chess) {
  for(const op of CUSTOM_OPERATORS)for(const form of ['a','b']){
    const rec=chess[`chess_custom_${op.tier}_${op.key}_${form}`];
    if(!rec)continue;
    rec.availableSkillIndices=[op.skillIndex];
    const seen=new Set();
    const visit=value=>{
      if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
      if(value.skillId?.startsWith('skchr_'))for(const field of ['desc','descRaw'])if(typeof value[field]==='string'){
        value[field]=value[field].replace(/^.*该技能可随时主动关闭.*$/gm,'');
        if(value.skillId==='skchr_wang_3')value[field]=value[field].replace('手动停止或棋子耗尽后技能结束','库存棋子下完后技能自动结束');
        if(value.skillId==='skchr_kalts2_2')value[field]=value[field].replace('可以随时停止技能','弹药用尽后技能自动结束');
        value[field]=value[field].replace(/[，,]?(?:可以|可)随时(?:主动)?(?:停止|关闭)(?:该)?技能/g,'').replace(/（\s*）/g,'');
        if(value.skillId==='skchr_wisdel_3'&&!value[field].includes('全部弹药'))value[field]+='\n打完全部弹药后技能自动结束';
        value[field]=value[field].trim();
      }
      for(const child of Object.values(value))visit(child);
    };visit(rec);
  }
}

export function addCustomCards(ctx) {
  const { act, charTable, uniequip } = ctx;
  const templates = new Map([5, 6].map(tier => {
    const shop = Object.values(act.charShopChessDatas).find(s => s.chessLevel === tier && !s.isHidden && s.chessType === 'NORMAL');
    if (!shop) throw new Error(`No training template for custom tier ${tier}`);
    return [tier, [act.charChessDataDict[shop.chessId], act.charChessDataDict[shop.goldenChessId]]];
  }));
  for (const [index, op] of CUSTOM_OPERATORS.entries()) {
    if (!charTable[op.charId]) throw new Error(`Missing custom operator ${op.charId}; refresh official data`);
    const base = `chess_custom_${op.tier}_${op.key}_a`, golden = base.replace(/_a$/, '_b');
    if (act.charShopChessDatas[base]) throw new Error(`Duplicate custom card ${base}`);
    const module = (uniequip.charEquip?.[op.charId] || []).find(id => uniequip.equipDict?.[id]?.type === 'ADVANCED') || null;
    act.bondInfoDict[op.bond].chessIdList.push(base);
    act.charShopChessDatas[base] = {
      chessId: base, goldenChessId: golden, chessLevel: op.tier, shopLevelSortId: 1000 + index,
      chessType: 'NORMAL', charId: op.charId, defaultSkillIndex: op.skillIndex, defaultUniEquipId: module,
      isHidden: false,
    };
    for (const [i, id] of [base, golden].entries()) {
      const status = structuredClone(templates.get(op.tier)[i].status);
      if (!module) status.equipLevel = 0;
      act.charChessDataDict[id] = {
        chessId: id, identifier: 10000 + index * 2 + i, isGolden: !!i, status,
        upgradeChessId: i ? null : golden, upgradeNum: i ? 0 : 3,
        bondIds: [op.bond], garrisonIds: [],
      };
      act.chessNormalIdLookupDict[id] = base;
    }
  }
}

// Feed the existing asset pipeline rather than introducing a second renderer/downloader.
export function addCustomAssetResearch(assets) {
  const art = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/';
  const spine = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/';
  assets.tokens ||= {};
  for (const [id, owner] of [['token_10064_wang_stone1','char_2027_wang'],['token_10035_wisdel_wward','char_1035_wisdel'],['token_10068_kalts2_mtship','char_1052_kalts2']]) {
    assets.tokens[id] = {avatar:{url:`${art}avatar/${id}.png`},battleSpineDefault:Object.fromEntries(['skel','atlas','png'].map(ext=>[ext,`${spine}${id}/${id}/Spine/${id}.${ext}`]))};
    // PRTS's live viewer publishes the original default token skeletons, including
    // newer tokens absent from the community GitHub dump. Keep the original stem.
    assets.tokens[id].battleSpineDefault=Object.fromEntries(['skel','atlas','png'].map(ext=>[ext,`https://torappu.prts.wiki/assets/char_spine/${id}/defaultskin/front/${id}.${ext}`]));
  }
  for (const op of CUSTOM_OPERATORS) {
    const id = op.charId;
    const model = side => Object.fromEntries(['skel', 'atlas', 'png'].map(ext => [ext, { url: `${spine}${id}/${id}/${side}/${id}.${ext}` }]));
    assets.operators[id] = {
      avatar: { e0e1: { url: `${art}avatar/${id}.png` }, e2: { url: `${art}avatar/${id}_2.png` } },
      portrait: { e0e1: { url: `${art}portrait/${id}_1.png` }, e2: { url: `${art}portrait/${id}_2.png` } },
      battleSpine: { front: model('Front'), back: model('Back') },
      skills: [0, 1, 2].map(index => {
        const skillId = `skchr_${op.key}_${index + 1}`;
        return { index, skillId, iconId: skillId, icon: { url: `${art}skill/skill_icon_${skillId}.png` } };
      }),
    };
  }
}
