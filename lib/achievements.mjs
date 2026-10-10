// Demonstration adapter only. No official FSP claim is made by these fixtures.
export const FSP_MAX_BONUS = 5;
const pointsByResult = { winner:100, finalist:60, participant:20 };
export function demoAchievement(candidate) {
 return {id:`demo-${candidate.id}-${candidate.specialization}-${candidate.grade}`,title:'DEMO · учебный турнир ФСП',provenance:'synthetic_seed',verified:true,specialization:candidate.specialization,grade:candidate.grade,resultType:'finalist',points:60};
}
export function historicalDemoAchievements(candidate) {
 if(!candidate.fsp)return [];
 return (Array.isArray(candidate.fspAchievements)?candidate.fspAchievements:[]).filter(item=>item&&item.verified===true&&item.provenance==='synthetic_seed'&&['Backend','Frontend'].includes(item.specialization)&&['Junior','Middle','Senior'].includes(item.grade)&&Object.hasOwn(pointsByResult,item.resultType)&&Number.isFinite(item.points)&&item.points>0).map(item=>({id:String(item.id||'demo').slice(0,100),title:`DEMO · ${String(item.title||'учебное достижение').replace(/^DEMO\s*[·:—-]?\s*/u,'').slice(0,120)}`,provenance:'synthetic_seed',verified:true,specialization:item.specialization,grade:item.grade,resultType:item.resultType,points:Math.min(100,pointsByResult[item.resultType],item.points)}));
}
// Historical records remain visible after category changes, but cannot boost
// a different current category. This adapter retains the old eligibility API.
export function verifiedDemoAchievements(candidate) {
 if(!candidate.categoryConfirmed)return [];
 return historicalDemoAchievements(candidate).filter(item=>item.specialization===candidate.specialization&&item.grade===candidate.grade);
}
export function achievementBonus(candidate,requirements,missing,baseMatch) {
 const achievements=verifiedDemoAchievements(candidate);
 const sameCategory=!!requirements.specialization&&!!requirements.grade&&candidate.specialization===requirements.specialization&&candidate.grade===requirements.grade;
 const eligible=sameCategory&&missing.length===0&&!(requirements.unverifiedRequirements||[]).length;
 const raw=eligible&&achievements.length?FSP_MAX_BONUS*Math.max(...achievements.map(item=>item.points))/100:0;
 // Additive, bounded, non-compounding. Stacking records cannot increase the cap.
 const bonus=Math.min(raw,Math.max(0,100-baseMatch));
 return {bonus,maxBonus:FSP_MAX_BONUS,eligibleCount:eligible?achievements.length:0,source:'synthetic_seed',limitation:'Только вымышленные DEMO-достижения; реестр ФСП не подключён.'};
}
