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
