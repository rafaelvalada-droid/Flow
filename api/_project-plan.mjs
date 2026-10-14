export const projectPlanSchema={type:'OBJECT',properties:{name:{type:'STRING'},description:{type:'STRING'},sections:{type:'ARRAY',items:{type:'OBJECT',properties:{id:{type:'STRING'},text:{type:'STRING'}},required:['id','text']}},milestones:{type:'ARRAY',items:{type:'OBJECT',properties:{name:{type:'STRING'},dueDate:{type:'STRING'}},required:['name','dueDate']}},risks:{type:'ARRAY',items:{type:'OBJECT',properties:{title:{type:'STRING'},mitigation:{type:'STRING'}},required:['title','mitigation']}}},required:['name','description','sections','milestones','risks']};
export function validateProjectPlan(value,fields,source){
 if(!value||typeof value.name!=='string'||!value.name.trim()||typeof value.description!=='string'||!value.description.trim()||!Array.isArray(value.sections)||!Array.isArray(value.milestones)||!Array.isArray(value.risks))throw new Error('Invalid plan');
 const allowed=new Set(fields.map(field=>field.id)),seen=new Set();
 const sections=value.sections.map(section=>{if(!section||!allowed.has(section.id)||seen.has(section.id)||typeof section.text!=='string'||!section.text.trim())throw new Error('Invalid section');seen.add(section.id);return {id:section.id,text:section.text.slice(0,4000)};});
 if(seen.size!==allowed.size||!seen.size)throw new Error('Incomplete plan');
 const milestones=value.milestones.slice(0,12).map(item=>{if(!item||typeof item.name!=='string')throw new Error('Invalid milestone');const date=typeof item.dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)&&source.includes(item.dueDate)&&Number.isFinite(Date.parse(item.dueDate+'T12:00:00Z'))&&new Date(item.dueDate+'T12:00:00Z').toISOString().slice(0,10)===item.dueDate?item.dueDate:'';return {name:item.name.slice(0,200),dueDate:date};});
 const risks=value.risks.slice(0,12).map(item=>{if(!item||typeof item.title!=='string'||typeof item.mitigation!=='string')throw new Error('Invalid risk');return {title:item.title.slice(0,200),mitigation:item.mitigation.slice(0,2000)};});
 return {name:value.name.trim().slice(0,100),description:value.description.slice(0,2000),sections,milestones,risks};
}
export const projectAssessmentSchema={type:'OBJECT',properties:{summary:{type:'STRING'},recommendations:{type:'ARRAY',items:{type:'OBJECT',properties:{modelId:{type:'STRING'},reason:{type:'STRING'},firstSteps:{type:'STRING'}},required:['modelId','reason','firstSteps']}}},required:['summary','recommendations']};
export function validateProjectAssessment(value,models){
 if(!value||typeof value.summary!=='string'||!value.summary.trim()||!Array.isArray(value.recommendations)||!value.recommendations.length)throw new Error('Invalid assessment');
 const allowed=new Set(models.map(model=>model.id)),seen=new Set();
 const recommendations=value.recommendations.slice(0,3).map(item=>{if(!item||!allowed.has(item.modelId)||seen.has(item.modelId)||typeof item.reason!=='string'||typeof item.firstSteps!=='string'||!item.reason.trim()||!item.firstSteps.trim())throw new Error('Invalid recommendation');seen.add(item.modelId);return {modelId:item.modelId,reason:item.reason.slice(0,2000),firstSteps:item.firstSteps.slice(0,2000)};});
 return {summary:value.summary.slice(0,3000),recommendations};
}
