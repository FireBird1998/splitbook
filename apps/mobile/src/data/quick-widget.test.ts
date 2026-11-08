import { expect, it } from 'vitest';
import { quickWidget, type QuickWidgetSetup } from '@splitbook/shared/quick-widget';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
const session={status:'authenticated' as const,accountId:'alex',loading:false};
const setup:QuickWidgetSetup={kind:'quick',widgetId:8,accountId:'alex',groupId:null};
const copy:WidgetCopy={version:1,accountId:'alex',home:null,savedGroups:{verifiedAt:1,rows:[{id:'maple',name:'Maple House',theme:'home',archived:false,members:3,currencies:1}]}};
it('defaults to Ask each time and names a chosen Group even for the icon-only widget',()=>{
 expect(quickWidget(copy,setup,'2x1',session)).toMatchObject({title:'Add expense',subtitle:'Choose a Group',target:'choose-group',summary:'Add expense. Choose a Group'});
 expect(quickWidget(copy,{...setup,groupId:'maple'},'1x1',session)).toMatchObject({title:'Add expense',subtitle:'Maple House',summary:'Add expense in Maple House',target:{kind:'expense',groupId:'maple'}});
});
for(const size of ['1x1','2x1'] as const)it(`keeps every account and access state safe at ${size}`,()=>{
 const chosen={...setup,groupId:'maple'};
 expect(quickWidget(copy,chosen,size,{status:'signed-out'})).toMatchObject({state:'signed-out',title:'Sign in',subtitle:null,target:'sign-in'});
 expect(quickWidget(copy,chosen,size,{status:'expired'})).toMatchObject({state:'expired',title:'Sign in again',subtitle:null,target:'sign-in'});
 expect(quickWidget(copy,chosen,size,{...session,accountId:'sam'})).toMatchObject({state:'other-account',title:'Set up again',subtitle:null,target:{kind:'setup',widgetId:8}});
 expect(quickWidget({...copy,lostGroupIds:['maple']},chosen,size,session)).toMatchObject({state:'lost-access',title:'Not in this Group',subtitle:'Choose a Group',target:{kind:'setup',widgetId:8}});
 expect(quickWidget({...copy,savedGroups:{...copy.savedGroups!,rows:[{...copy.savedGroups!.rows[0],archived:true}]}},chosen,size,session)).toMatchObject({state:'archived',title:'Group archived',subtitle:'Choose another',target:{kind:'setup',widgetId:8}});
 for(const status of [{status:'signed-out' as const},{status:'expired' as const},{...session,accountId:'sam'}])expect(JSON.stringify(quickWidget(copy,chosen,size,status))).not.toContain('Maple');
});
