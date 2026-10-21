import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig(
	{ ignores: ['lib/**'] },
	eslint.configs.recommended,
	tseslint.configs.recommended,
	prettierRecommended,
	{
		rules: {
			'no-console': 'off',
			'@typescript-eslint/no-explicit-any': 'warn',
		},
	},
);
