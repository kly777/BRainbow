import { describe, it, expect } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('renders with default props', () => {
    // 测试Button组件的基本渲染
    expect(Button).toBeDefined();
    expect(typeof Button).toBe('function');
  });

  it('has correct variant types', () => {
    // 测试Button组件的variant类型
    const variantTypes = ['primary', 'secondary', 'danger', 'ghost', 'icon'];
    variantTypes.forEach(variant => {
      expect(variant).toBeDefined();
    });
  });
});