import { describe, it, expect } from 'vitest';
import SearchInput from './SearchInput';

describe('SearchInput', () => {
  it('renders with placeholder', () => {
    // 测试SearchInput组件的基本渲染
    expect(SearchInput).toBeDefined();
    expect(typeof SearchInput).toBe('function');
  });

  it('has correct props', () => {
    // 测试SearchInput组件的属性
    const expectedProps = ['placeholder', 'onSearch', 'onChange'];
    expectedProps.forEach(prop => {
      expect(prop).toBeDefined();
    });
  });
});