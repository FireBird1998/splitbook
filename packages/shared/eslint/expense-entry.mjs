import ts from 'typescript';

/** Reviewed ownership, not a list of forms exempted from the rule. */
export const entryExceptions = [
  {
    path: '**/*.{test,spec}.{ts,tsx}',
    reason: 'Tests exercise old and refused commands deliberately.',
  },
  {
    path: '**/{test-utils,test-support,fixtures,__fixtures__,__mocks__}/**',
    reason: 'Fictional fixture and adapter data, not member entry.',
  },
  {
    path: '**/scripts/**',
    reason: 'Demo seeds and standalone tooling do not read an Expense form.',
  },
  {
    path: 'packages/shared/src/expense-entry.ts',
    reason: 'The one Expense-entry reading owns typed figures.',
  },
  {
    path: 'packages/shared/src/expense-entry-draft.ts',
    reason: 'The only Entry/Draft conversion pair owns partial typed facts.',
  },
  {
    path: 'packages/shared/src/exact-money.ts',
    reason: 'The server and reading share these exact-money primitives.',
  },
  {
    path: 'packages/shared/src/expense-money-edit.ts',
    reason: 'The server and reading share historical-money preservation and edit comparison.',
  },
  {
    path: 'packages/shared/src/validators/**',
    reason:
      'Server command validation and Draft completion remain independent of client entry policies.',
  },
];
const owned = new Set(
  entryExceptions.filter(({ path }) => !path.includes('*')).map(({ path }) => path),
);
const figures = new Set(['amount', 'percentage', 'shares', 'amountMinor']);
const ledgerRows = new Set(['paidBy', 'splitBetween']);
const pathOf = (filename) =>
  filename
    .replaceAll('\\', '/')
    .match(/(?:^|\/)((?:apps\/(?:mobile|web)|packages\/shared)\/.*)$/)?.[1] ?? filename;
function exempt(filename) {
  const path = pathOf(filename);
  return (
    owned.has(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /\/(test-utils|test-support|fixtures|__fixtures__|__mocks__|scripts)\//.test(path) ||
    path.startsWith('packages/shared/src/validators/')
  );
}
const nameOf = (node) =>
  node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
function unwrap(node) {
  while (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

export const entryTranslationPlugin = {
  rules: {
    'no-local-reading': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          useReading:
            'Read typed Expense figures through readExpenseEntry or the Draft conversion pair.',
        },
      },
      create(context) {
        if (exempt(context.filename)) return {};
        const services = context.sourceCode.parserServices;
        if (!services?.program)
          throw new Error('Expense entry lint requires the TypeScript program.');
        const checker = services.program.getTypeChecker();
        // Mobile and shared use different TypeScript majors; TypeFlags are not stable between them.
        const stringType = (type) =>
          checker.typeToString(checker.getBaseTypeOfLiteralType(type)) === 'string' ||
          ((type.isUnion() || type.isIntersection()) && type.types.some(stringType));
        const stringValue = (node) => stringType(checker.getTypeAtLocation(unwrap(node)));
        function declarations(node) {
          let symbol =
            ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
              ? checker.getShorthandAssignmentValueSymbol(node.parent)
              : checker.getSymbolAtLocation(node);
          if (
            symbol?.declarations?.some(
              (declaration) => ts.isImportSpecifier(declaration) || ts.isImportClause(declaration),
            )
          )
            symbol = checker.getAliasedSymbol(symbol);
          return symbol?.declarations ?? [];
        }
        function convertedText(node, seen = new Set()) {
          node = unwrap(node);
          if (seen.has(node)) return false;
          seen.add(node);
          if (stringValue(node)) return true;
          if (ts.isIdentifier(node)) {
            for (const declaration of declarations(node))
              if (
                ts.isVariableDeclaration(declaration) &&
                declaration.initializer &&
                convertedText(declaration.initializer, seen)
              )
                return true;
          }
          if (ts.isCallExpression(node)) {
            // Money formatters also take a currency string; only the value argument is input.
            if (node.arguments[0] && convertedText(node.arguments[0], seen)) return true;
            for (const declaration of declarations(node.expression)) {
              if (exempt(declaration.getSourceFile().fileName)) continue;
              const body =
                declaration.body ??
                (ts.isVariableDeclaration(declaration) &&
                declaration.initializer &&
                (ts.isArrowFunction(declaration.initializer) ||
                  ts.isFunctionExpression(declaration.initializer))
                  ? declaration.initializer.body
                  : null);
              if (!body) continue;
              if (!ts.isBlock(body) && convertedText(body, seen)) return true;
              let found = false;
              const returnedText = (part) => {
                if (
                  ts.isReturnStatement(part) &&
                  part.expression &&
                  convertedText(part.expression, seen)
                )
                  found = true;
                if (!found) part.forEachChild(returnedText);
              };
              returnedText(body);
              if (found) return true;
            }
          }
          if (ts.isPrefixUnaryExpression(node)) return convertedText(node.operand, seen);
          if (ts.isBinaryExpression(node))
            return convertedText(node.left, seen) || convertedText(node.right, seen);
          if (ts.isConditionalExpression(node))
            return convertedText(node.whenTrue, seen) || convertedText(node.whenFalse, seen);
          return false;
        }
        function unsafe(node, seen = new Set()) {
          node = unwrap(node);
          // A whole typed row array is a translation too, even with no explicit Number().
          const type = checker.getTypeAtLocation(node);
          const row = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
          if (row?.getProperty('user')) {
            for (const field of figures) {
              const property = row.getProperty(field);
              if (property && stringType(checker.getTypeOfSymbolAtLocation(property, node)))
                return true;
            }
          }
          // Forwarding already-read rows is ordinary projection, not another reading.
          if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
            return false;
          if (seen.has(node)) return false;
          seen.add(node);
          if (ts.isIdentifier(node)) {
            for (const declaration of declarations(node)) {
              if (
                ts.isVariableDeclaration(declaration) &&
                declaration.initializer &&
                unsafe(declaration.initializer, seen)
              )
                return true;
              // Array mutations can fill an initially empty command collection later.
              // Resolve the binding, rather than treating a same-spelled row list as its alias.
              if (ts.isVariableDeclaration(declaration)) {
                let changed = false;
                const binding = checker.getSymbolAtLocation(declaration.name);
                const sameBinding = (value) =>
                  ts.isIdentifier(value) && checker.getSymbolAtLocation(value) === binding;
                const mutation = (part) => {
                  if (
                    ts.isCallExpression(part) &&
                    ts.isPropertyAccessExpression(part.expression) &&
                    sameBinding(part.expression.expression) &&
                    ['push', 'unshift', 'splice'].includes(part.expression.name.text)
                  )
                    changed ||= part.arguments.some((argument) => unsafe(argument, seen));
                  if (
                    ts.isBinaryExpression(part) &&
                    part.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                    ts.isElementAccessExpression(part.left) &&
                    sameBinding(part.left.expression)
                  )
                    changed ||= unsafe(part.right, seen);
                  if (!changed) part.forEachChild(mutation);
                };
                mutation(declaration.getSourceFile());
                if (changed) return true;
              }
              if (
                (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) &&
                declaration.body &&
                !exempt(declaration.getSourceFile().fileName) &&
                unsafe(declaration.body, seen)
              )
                return true;
            }
          }
          let found = false;
          function visit(part) {
            if (
              ts.isPropertyAssignment(part) &&
              figures.has(nameOf(part.name)) &&
              convertedText(part.initializer)
            )
              found = true;
            if (
              ts.isShorthandPropertyAssignment(part) &&
              figures.has(part.name.text) &&
              convertedText(part.name)
            )
              found = true;
            if (!found && ts.isIdentifier(part) && part !== node && unsafe(part, seen))
              found = true;
            if (!found) part.forEachChild(visit);
          }
          visit(node);
          return found;
        }
        return {
          Property(node) {
            const property = services.esTreeNodeToTSNodeMap.get(node);
            const value = ts.isPropertyAssignment(property)
              ? property.initializer
              : ts.isShorthandPropertyAssignment(property)
                ? property.name
                : null;
            if (value && ledgerRows.has(nameOf(property.name)) && unsafe(value))
              context.report({ node, messageId: 'useReading' });
          },
          AssignmentExpression(node) {
            const assignment = services.esTreeNodeToTSNodeMap.get(node);
            const left = assignment.left;
            const field = ts.isPropertyAccessExpression(left)
              ? nameOf(left.name)
              : ts.isElementAccessExpression(left)
                ? nameOf(left.argumentExpression)
                : nameOf(left);
            if (ledgerRows.has(field) && unsafe(assignment.right))
              context.report({ node, messageId: 'useReading' });
          },
        };
      },
    },
  },
};

/** All three lint commands, and therefore the gate, use exactly this rule and scope. */
export function expenseEntryLint(root) {
  return [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: [
        'src/**/*.d.ts',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/{test-utils,test-support,fixtures,__fixtures__,__mocks__}/**',
      ],
      languageOptions: {
        parserOptions: {
          // Existing lint-contract suites submit these virtual files through lintText.
          // They get a real program too; none is exempt from the entry rule.
          projectService: {
            allowDefaultProject: [
              'src/lint-sample.ts',
              'src/data/sample-controller.ts',
              'src/ui/sample-screen.tsx',
            ],
          },
          tsconfigRootDir: root,
        },
      },
      plugins: { 'expense-entry': entryTranslationPlugin },
      rules: { 'expense-entry/no-local-reading': 'error' },
    },
  ];
}
