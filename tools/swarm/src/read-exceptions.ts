import type { AllowedReadSite } from './read-contract.ts';

// Reviewed sites, not path-wide exemptions. A missing, changed or duplicated site fails.
export const readExceptions = [
  {
    path: 'apps/web/src/app/api/groups/[id]/expenses/[expenseId]/route.ts',
    within: 'FunctionDeclaration PATCH#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id!)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/[id]/expenses/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id!)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/[id]/expenses/tag-change/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id!)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/[id]/invite/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id!)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/[id]/settlements/batch/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id!)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/[id]/settlements/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id!)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/[id]/tags/[tagId]/route.ts',
    within: 'FunctionDeclaration mutate#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/[id]/tags/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'groupService.isMember(id,user.id)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/app/api/groups/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'isGroupAdmin(created,user.id!)',
    reason:
      'Select visible controls, names or email fields from already delivered/admitted Group data; this does not admit a ledger read.',
  },
  {
    path: 'apps/web/src/app/api/join/[code]/route.ts',
    within: 'FunctionDeclaration POST#1',
    operation: 'membership',
    site: 'group.members.some((m)=>{constmemberUser=m.userasunknownas{_id:{toString():string}};returnmemberUser._id.toString()===user.id;})',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/components/insights/GroupInsightsTab.tsx',
    within: 'FunctionDeclaration GroupInsightsTab#1',
    operation: 'membership',
    site: "group.members.some((member)=>member.user._id===userId&&member.role==='admin',)",
    reason:
      'Select visible controls, names or email fields from already delivered/admitted Group data; this does not admit a ledger read.',
  },
  {
    path: 'apps/web/src/components/insights/insights-cards.ts',
    within: 'FunctionDeclaration whoPaidModel#1',
    operation: 'membership',
    site: 'part.members.filter((member)=>member.isMember)',
    reason:
      'Select visible controls, names or email fields from already delivered/admitted Group data; this does not admit a ledger read.',
  },
  {
    path: 'apps/web/src/components/insights/insights-cards.ts',
    within: 'FunctionDeclaration whoPaidModel#1',
    operation: 'membership',
    site: 'part.members.every((member)=>member.isMember)',
    reason:
      'Select visible controls, names or email fields from already delivered/admitted Group data; this does not admit a ledger read.',
  },
  {
    path: 'apps/web/src/components/insights/insights-cards.ts',
    within: 'FunctionDeclaration whoPaidModel#1',
    operation: 'membership',
    site: 'part.members.every((member)=>member.paidMinor===0)',
    reason:
      'Select visible controls, names or email fields from already delivered/admitted Group data; this does not admit a ledger read.',
  },
  {
    path: 'apps/web/src/lib/demo/seed-groups.ts',
    within: 'FunctionDeclaration ensureMembers#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: 'group.members.some((member)=>member.user.toString()===memberId)',
    reason:
      'Explicit local demo seeding checks seeded members or materializes its fictional ledger, not a member read.',
  },
  {
    path: 'apps/web/src/lib/demo/seed-groups.ts',
    within: 'FunctionDeclaration insertLedger#1',
    operation: 'recurring',
    site: 'recurringExpenseService.materializeDueExpenses(plan.groupId)',
    reason:
      'Explicit local demo seeding checks seeded members or materializes its fictional ledger, not a member read.',
  },
  {
    path: 'apps/web/src/lib/demo/seed.ts',
    within: 'FunctionDeclaration ensureMembers#1',
    operation: 'membership',
    site: 'group.members.some((m)=>m.user.toString()===memberId)',
    reason:
      'Explicit local demo seeding checks seeded members or materializes its fictional ledger, not a member read.',
  },
  {
    path: 'apps/web/src/lib/group-cleanup.ts',
    within: 'FunctionDeclaration inventoryOrphanGroups#1',
    operation: 'membership',
    site: "db.collection('groups').find({members:{$type:'array',$size:0}})",
    reason:
      'Claim or report a memberless Group for confirmed deletion/maintenance, not actor admission to a ledger read.',
  },
  {
    path: 'apps/web/src/lib/group-member-emails.ts',
    within: 'ArrowFunction isGroupAdmin#1',
    operation: 'membership',
    site: "group.members.some((member)=>String((member.useras{_id:unknown})._id)===viewerId&&member.role==='admin',)",
    reason:
      'Select visible controls, names or email fields from already delivered/admitted Group data; this does not admit a ledger read.',
  },
  {
    path: 'apps/web/src/lib/group-read.ts',
    within: 'FunctionDeclaration belongsToActor#1',
    operation: 'membership',
    site: 'group.members.some((member)=>member.user._id===actorId)',
    reason:
      'Client DTO verification rejects another account’s HTTP answer; server admission is owned by group-ledger-read.ts.',
  },
  {
    path: 'apps/web/src/lib/ledger-recording.ts',
    within: 'FunctionDeclaration changeLedgerExpense#1',
    operation: 'membership',
    site: "Group.findOne({_id:groupId,'members.user':actorId})",
    reason:
      'Candidate 2 checks membership inside the Expense recording boundary; reads cannot use this gate.',
  },
  {
    path: 'apps/web/src/lib/notifications/dispatch.ts',
    within: 'FunctionDeclaration runDispatch#1/ArrowFunction attempt#1',
    operation: 'membership',
    site: "db.collection('groups').findOne({_id:newObjectId(context.groupId),'members.user':newObjectId(row.accountId),deletionRequestedAt:null,},{projection:{_id:1},maxTimeMS:500},)",
    reason:
      'Recheck the immutable notification recipient’s current access before sending; no ledger read is delivered.',
  },
  {
    path: 'apps/web/src/lib/notifications/dispatch.ts',
    within: 'FunctionDeclaration runDispatch#1/ArrowFunction attempt#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: "db.collection('groups').findOne({_id:newObjectId(context.groupId),'members.user':newObjectId(row.accountId),deletionRequestedAt:null,},{projection:{_id:1},maxTimeMS:500},)",
    reason:
      'Recheck the immutable notification recipient’s current access before sending; no ledger read is delivered.',
  },

  {
    path: 'apps/web/src/lib/services/assistant-ledger.service.ts',
    within:
      'MethodDeclaration assistantLedgerService.approvalGroups#1/ArrowFunction read#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: "group.members.some((member)=>String(member.user)===String(setBy._id)&&member.role==='admin',)",
    reason:
      'Choose the name of the admin who set the Assistant rule; admission already ran through readGroupLedgers.',
  },

  {
    path: 'apps/web/src/lib/services/expense-draft.service.ts',
    within: 'FunctionDeclaration requireMembership#1',
    operation: 'membership',
    site: 'assistantGroupFilter({memberId:scope.owner,...reach})',
    reason:
      'Draft mutations check Group access inside their recording. Read callers use the ledger module.',
  },
  {
    path: 'apps/web/src/lib/services/expense-draft.service.ts',
    within: 'FunctionDeclaration requireMembership#1',
    operation: 'membership',
    site: "mongoose.connection.db!.collection('groups').findOne(filter?{...filter,_id:{...filter._id,$eq:scope.group}}:{_id:scope.group,'members.user':scope.owner,deletionRequestedAt:null},{session,projection:{_id:1,defaultCurrency:1,alternateCurrencies:1,isArchived:1},},)",
    reason:
      'Draft mutations check Group access inside their recording. Read callers use the ledger module.',
  },
  {
    path: 'apps/web/src/lib/services/expense-draft.service.ts',
    within: 'FunctionDeclaration mutate#1',
    operation: 'membership',
    site: 'requireMembership(scope,undefined,refuseArchived)',
    reason:
      'Draft recording or review of a save rechecks account/Group membership; the write and its transaction remain outside the read module.',
  },
  {
    path: 'apps/web/src/lib/services/expense-draft.service.ts',
    within: 'FunctionDeclaration mutate#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: 'requireMembership(scope,session,refuseArchived,assistantReach(actor),)',
    reason:
      'Draft recording or review of a save rechecks account/Group membership; the write and its transaction remain outside the read module.',
  },
  {
    path: 'apps/web/src/lib/services/expense-draft.service.ts',
    within: 'FunctionDeclaration reviewDraft#1',
    operation: 'membership',
    site: 'requireMembership(scope,session)',
    reason:
      'Draft recording or review of a save rechecks account/Group membership; the write and its transaction remain outside the read module.',
  },
  {
    path: 'apps/web/src/lib/services/expense-draft.service.ts',
    within: 'MethodDeclaration expenseDraftService.save#1',
    operation: 'membership',
    site: "mongoose.connection.db!.collection('groups').findOne({_id:scope.group,'members.user':scope.owner,deletionRequestedAt:null},{projection:{isArchived:1}},)",
    reason:
      'Draft recording or review of a save rechecks account/Group membership; the write and its transaction remain outside the read module.',
  },

  {
    path: 'apps/web/src/lib/services/expense.service.ts',
    within: 'MethodDeclaration ExpenseService.requireWritableGroup#1',
    operation: 'membership',
    site: "Group.findOne({_id:groupId,'members.user':actorId})",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/expense.service.ts',
    within: 'MethodDeclaration ExpenseService.changeTags#1',
    operation: 'membership',
    site: "this.requireWritableGroup({actorId,groupId,expenseId:''})",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group-cleanup.service.ts',
    within: 'FunctionDeclaration applyOrphanGroupManifest#1/ArrowFunction check#1',
    operation: 'membership',
    site: "db.collection('groups').findOne({_id:id,members:{$type:'array',$size:0},deletionRequestedAt:null},{session},)",
    reason:
      'Claim or report a memberless Group for confirmed deletion/maintenance, not actor admission to a ledger read.',
  },
  {
    path: 'apps/web/src/lib/services/group-currency.service.ts',
    within: 'ArrowFunction isMember#1',
    operation: 'membership',
    site: 'group.members.some((member)=>String(member.user)===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group-currency.service.ts',
    within: 'ArrowFunction isAdmin#1',
    operation: 'membership',
    site: "group.members.some((member)=>String(member.user)===userId&&member.role==='admin')",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group-currency.service.ts',
    within: 'FunctionDeclaration memberGroup#1',
    operation: 'membership',
    site: 'isMember(group,userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group-currency.service.ts',
    within: 'FunctionDeclaration settings#1',
    operation: 'membership',
    site: 'memberGroup(groupId,viewerId,null)',
    reason:
      'Currency add/remove response re-admits through memberGroup using findById and isMember. This post-write path omits the deletion-marker rule. The public settings read uses readGroupMetadata.',
  },
  {
    path: 'apps/web/src/lib/services/group-currency.service.ts',
    within: 'MethodDeclaration groupCurrencyService.add#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: 'memberGroup(groupId,actorId,session??null)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group-currency.service.ts',
    within: 'MethodDeclaration groupCurrencyService.remove#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: 'memberGroup(groupId,actorId,session??null)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group-currency.service.ts',
    within: 'MethodDeclaration groupCurrencyService.remove#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: 'isAdmin(group,actorId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.findCreated#1',
    operation: 'membership',
    site: 'existing.members.some((member)=>member.user.toString()===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.readForMember#1',
    operation: 'membership',
    site: 'isGroupAdmin(group,viewer.id)',
    reason:
      'Server-side role-based disclosure: isGroupAdmin decides whether this admitted read returns every member’s email. That disclosure policy currently lives outside the read module.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.update#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.update#1/ArrowFunction <callback>#2',
    operation: 'membership',
    site: "Group.findOneAndUpdate({_id:groupId,defaultCurrency:group.defaultCurrency,currencyLocked:{$ne:true},members:{$elemMatch:{user:userId,role:'admin'}},},{$set:data},{returnDocument:'after',runValidators:true},)",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.setAssistantRule#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: 'Group.findOneAndUpdate({_id:groupId,...admin,assistantRule:otherRule},{$set:{assistantRule:rule,assistantRuleSetBy:userId}},)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.setAssistantRule#1',
    operation: 'membership',
    site: 'Group.exists({_id:groupId,...admin})',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.archive#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.isMember#1',
    operation: 'membership',
    site: "Group.findOne({_id:groupId,'members.user':userId,})",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.addMember#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.updateMemberRole#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===actorId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.updateMemberRole#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===targetUserId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.updateMemberRole#1',
    operation: 'membership',
    site: "group.members.filter((m)=>m.role==='admin')",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.departureBlock#1',
    operation: 'recurring',
    site: 'recurringExpenseService.materializeDueExpenses(groupId)',
    reason:
      'A leave or member removal must materialize before its open-balance check; incomplete generation refuses the write.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.removeMember#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===actorId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.removeMember#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===targetUserId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.removeMember#1',
    operation: 'membership',
    site: "group.members.filter((m)=>m.role==='admin')",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.removeMember#1/ArrowFunction <callback>#4',
    operation: 'membership',
    site: "Group.findOneAndUpdate({_id:groupId,'members.user':targetUserId,members:{$elemMatch:{user:actorId,role:'admin'}},},{$pull:{members:{user:targetUserId}},$inc:{__v:1}},{returnDocument:'after'},)",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.leave#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===actorId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.leave#1',
    operation: 'membership',
    site: 'group.members.filter((m)=>m.user.toString()!==actorId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.leave#1/ArrowFunction <callback>#4',
    operation: 'membership',
    site: "Group.findOneAndUpdate({$and:[{_id:groupId},{'members.user':actorId},stillHandedOver]},{$pull:{members:{user:actorId}},$inc:{__v:1}},)",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.generateInviteCode#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/invitation.service.ts',
    within: 'MethodDeclaration InvitationService.accept#1',
    operation: 'membership',
    site: 'group.members.some((m)=>m.user.toString()===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'FunctionDeclaration assertAdmin#1',
    operation: 'membership',
    site: 'group.members.find((m)=>m.user.toString()===userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'MethodDeclaration RecurringExpenseService.create#1',
    operation: 'membership',
    site: 'assertAdmin(group,userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'MethodDeclaration RecurringExpenseService.create#1',
    operation: 'recurring',
    site: 'this.generateDueExpenses(groupId)',
    reason:
      'Creating or editing a recurring template explicitly generates its due Expense as part of that member-started write.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'MethodDeclaration RecurringExpenseService.update#1',
    operation: 'membership',
    site: 'assertAdmin(group,userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'MethodDeclaration RecurringExpenseService.update#1',
    operation: 'recurring',
    site: 'this.generateDueExpenses(groupId)',
    reason:
      'Creating or editing a recurring template explicitly generates its due Expense as part of that member-started write.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'MethodDeclaration RecurringExpenseService.remove#1',
    operation: 'membership',
    site: 'assertAdmin(group,userId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'MethodDeclaration RecurringExpenseService.generateDueExpenses#1',
    operation: 'recurring',
    site: 'this.materializeDueExpenses(groupId,now)',
    reason:
      'The generator delegates to its own implementation; all external read entry points belong to the read module.',
  },
  {
    path: 'apps/web/src/lib/services/recurring-expense.service.ts',
    within: 'MethodDeclaration RecurringExpenseService.generateDueExpensesForGroups#1',
    operation: 'recurring',
    site: 'this.generateDueExpenses(groupId,now)',
    reason:
      'The generator delegates to its own implementation; all external read entry points belong to the read module.',
  },
  {
    path: 'apps/web/src/lib/services/tag-management.service.ts',
    within: 'FunctionDeclaration snapshot#1',
    operation: 'membership',
    site: "group.members.some((member)=>String(member.user)===actorId&&member.role==='admin',)",
    reason:
      'Select visible controls, names or email fields from already delivered/admitted Group data; this does not admit a ledger read.',
  },
  {
    path: 'apps/web/src/lib/services/tag-management.service.ts',
    within: 'FunctionDeclaration accessibleGroup#1',
    operation: 'membership',
    site: "Group.findOne({_id:groupId,deletionRequestedAt:null,'members.user':actorId,})",
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/tag-management.service.ts',
    within: 'MethodDeclaration tagManagementService.submit#1',
    operation: 'membership',
    site: 'accessibleGroup(groupId,actorId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/lib/services/tag-management.service.ts',
    within: 'MethodDeclaration tagManagementService.submit#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: 'accessibleGroup(groupId,actorId)',
    reason:
      'Membership or role validation for this member-started write (including its replay/response); not a ledger read entry point.',
  },
  {
    path: 'apps/web/src/components/groups/GroupSettingsView.tsx',
    within: 'FunctionDeclaration GroupSettingsContent#1',
    operation: 'membership',
    site: 'members.find((m)=>m.user._id===userId)',
    reason:
      'Choose controls and member labels from an already delivered Group; no server read is admitted.',
  },
  {
    path: 'apps/web/src/components/groups/GroupSettingsView.tsx',
    within: 'FunctionDeclaration GroupSettingsContent#1',
    operation: 'membership',
    site: "members.filter((m)=>m.role==='admin'&&m.user._id!==userId)",
    reason:
      'Choose controls and member labels from an already delivered Group; no server read is admitted.',
  },
  {
    path: 'apps/web/src/components/groups/GroupSettingsView.tsx',
    within: 'FunctionDeclaration GroupSettingsContent#1',
    operation: 'membership',
    site: 'members.find((m)=>m.user._id===selectedMember)',
    reason:
      'Choose controls and member labels from an already delivered Group; no server read is admitted.',
  },
  {
    path: 'apps/web/src/lib/services/group-cleanup.service.ts',
    within: 'FunctionDeclaration requestGroupDeletion#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: "db.collection('groups').updateOne({_id:id,members:{$size:1},'members.user':newmongoose.Types.ObjectId(actorId),deletionRequestedAt:null,},{$set:{members:[],isArchived:true,deletionRequestedAt:newDate(),inviteCode:null,inviteCodeExpiresAt:null,},$inc:{__v:1},},{session},)",
    reason:
      'Confirmed Group deletion or orphan maintenance uses this membership fence; no ledger read is delivered.',
  },
  {
    path: 'apps/web/src/lib/services/group-cleanup.service.ts',
    within: 'FunctionDeclaration resumeGroupDeletion#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: "db.collection('groups').updateOne({_id:id,members:{$type:'array',$size:0},deletionRequestedAt:{$type:'date'},},{$inc:{mutationSequence:1}},{session},)",
    reason:
      'Confirmed Group deletion or orphan maintenance uses this membership fence; no ledger read is delivered.',
  },
  {
    path: 'apps/web/src/lib/services/group-cleanup.service.ts',
    within: 'FunctionDeclaration resumeGroupDeletion#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: "db.collection('groups').deleteOne({_id:id,members:{$size:0}},{session})",
    reason:
      'Confirmed Group deletion or orphan maintenance uses this membership fence; no ledger read is delivered.',
  },
  {
    path: 'apps/web/src/lib/services/group-cleanup.service.ts',
    within: 'FunctionDeclaration applyOrphanGroupManifest#1/ArrowFunction <callback>#1',
    operation: 'membership',
    site: "db.collection('groups').updateOne({_id:id,members:{$type:'array',$size:0},deletionRequestedAt:null},{$set:{isArchived:true,deletionRequestedAt:newDate(),inviteCode:null,inviteCodeExpiresAt:null,},$inc:{__v:1},},{session},)",
    reason:
      'Confirmed Group deletion or orphan maintenance uses this membership fence; no ledger read is delivered.',
  },
  {
    path: 'apps/web/src/components/expenses/ExpenseFields.tsx',
    within: 'FunctionDeclaration ExpenseFields#1/ArrowFunction addPayer#1',
    operation: 'membership',
    site: 'members.find((m)=>!usedUsers.includes(m.user._id))',
    reason:
      'A client form selects member labels or controls from already delivered Group data; it does not admit a server ledger read.',
  },
  {
    path: 'apps/web/src/components/expenses/ExpenseFields.tsx',
    within: 'FunctionDeclaration ExpenseFields#1/FunctionDeclaration memberName#1',
    operation: 'membership',
    site: 'members.find((m)=>m.user._id===id)',
    reason:
      'A client form selects member labels or controls from already delivered Group data; it does not admit a server ledger read.',
  },
  {
    path: 'apps/web/src/components/expenses/quick-add-view.ts',
    within: 'FunctionDeclaration quickAddModel#1/ArrowFunction nameOf#1',
    operation: 'membership',
    site: 'members.find((member)=>member.id===id)',
    reason:
      'A client form selects member labels or controls from already delivered Group data; it does not admit a server ledger read.',
  },
  {
    path: 'apps/web/src/components/expenses/quick-add-view.ts',
    within: 'FunctionDeclaration quickAddModel#1/ArrowFunction shortName#1',
    operation: 'membership',
    site: 'members.filter((member)=>member.id!==id&&member.name.split(/\\s+/u)[0]===first,)',
    reason:
      'A client form selects member labels or controls from already delivered Group data; it does not admit a server ledger read.',
  },
  {
    path: 'apps/web/src/components/groups/AssistantRuleSection.tsx',
    within: 'FunctionDeclaration AssistantRuleSection#1',
    operation: 'membership',
    site: "members.some((m)=>m.user._id===viewerId&&m.role==='admin')",
    reason:
      'A client form selects member labels or controls from already delivered Group data; it does not admit a server ledger read.',
  },
  {
    path: 'apps/web/src/components/groups/RecurringExpensesSection.tsx',
    within: 'FunctionDeclaration RecurringExpensesSection#1/ArrowFunction memberName#1',
    operation: 'membership',
    site: 'members.find((m)=>m.user._id===id)',
    reason:
      'A client form selects member labels or controls from already delivered Group data; it does not admit a server ledger read.',
  },
  {
    path: 'apps/web/src/components/groups/RecurringExpensesSection.tsx',
    within: 'FunctionDeclaration RecurringExpensesSection#1',
    operation: 'membership',
    site: 'members.filter(({user})=>entry.participantIds.includes(user._id))',
    reason:
      'A client form selects member labels or controls from already delivered Group data; it does not admit a server ledger read.',
  },
  {
    path: 'apps/web/src/lib/ledger-recording.ts',
    within: 'FunctionDeclaration recordLedger#1/ArrowFunction checkMembers#1',
    operation: 'membership',
    site: 'members.has(actorId)',
    reason:
      'The ledger recording boundary verifies the member actor before a new save and at its commit.',
  },
  {
    path: 'apps/web/src/lib/ledger-recording.ts',
    within: 'FunctionDeclaration requireCommitGroup#1',
    operation: 'membership',
    site: 'members.has(actorId)',
    reason: 'Expense mutation rechecks the member actor at the financial commit fence.',
  },
  {
    path: 'apps/web/src/lib/services/group.service.ts',
    within: 'MethodDeclaration GroupService.leave#1',
    operation: 'membership',
    site: "others.some((m)=>m.role==='admin')",
    reason: 'Leaving checks whether another admin remains before permitting the member departure.',
  },
  {
    path: 'apps/web/src/lib/services/search.service.ts',
    within: 'MethodDeclaration SearchService.search#1/ArrowFunction read#1',
    operation: 'membership',
    site: "for(const{user}ofgroup.members){if(!user||typeofuser.name!=='string')continue;constid=String(user._id);if(id===userId)continue;constknown=people.get(id);if(known)known.groupCount+=1;elseif(matchesSearch(user.name,terms))people.set(id,{id,name:user.name,groupId:String(group._id),groupName:group.name,groupCount:1,});}",
    reason:
      'The admitted across-Group read projects people results from its supplied members, checking name availability and omitting the viewer.',
  },
] satisfies readonly AllowedReadSite[];
