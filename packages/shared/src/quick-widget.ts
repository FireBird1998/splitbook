import type { WidgetCopy, WidgetSession, WidgetTarget } from './balances-widget';
export interface QuickWidgetSetup { kind:'quick';widgetId:number;accountId:string;groupId:string|null; }
export function quickWidget(copy:WidgetCopy|null,setup:QuickWidgetSetup,size:'1x1'|'2x1',session:WidgetSession) {
 const group=setup.groupId && copy?.accountId===setup.accountId ? copy.savedGroups?.rows.find(g=>g.id===setup.groupId) ?? copy.groups?.[setup.groupId]:null;
 const subtitle=group?.name ?? 'Choose a Group';
 return {state:'normal',size,title:'Add expense',subtitle,summary:group?`Add expense in ${group.name}`:'Add expense. Choose a Group',target:(setup.groupId?{kind:'expense',groupId:setup.groupId}:'choose-group') as WidgetTarget};
}
