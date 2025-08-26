import eslint from '@eslint/js';
import tslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import pluginChaiFriendly from 'eslint-plugin-chai-friendly';

export default tslint.config(
	eslint.configs.recommended,
	...tslint.configs.recommended,
	{
		ignores: ['lib'],
	},
	{
		//files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
		linterOptions: {
			reportUnusedDisableDirectives: true,
		},
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
				...globals.es2022,
			},
			sourceType: 'module',
		},
		plugins: { 'chai-friendly': pluginChaiFriendly },
		rules: {
			'@typescript-eslint/no-unused-expressions': 0,
			'unused-expressions': 0,
			'chai-friendly/no-unused-expressions': ['error', { allowTernary: true }],
			'@typescript-eslint/no-non-null-assertion': 0,
			'@typescript-eslint/no-explicit-any': 0,
			'no-console': ['error'],
		},
	},
	eslintPluginPrettierRecommended,
);
