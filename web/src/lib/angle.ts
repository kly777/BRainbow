/** 角度值类型 —— 内部以弧度存储，对外暴露 degree / radian */
export class Angle {
  private _value: number;

  constructor(radian: number) {
    this._value = radian;
  }

  get degree(): number {
    return (this._value * 180) / Math.PI;
  }

  get radian(): number {
    return this._value;
  }

  /** 从角度创建 */
  static fromDegree(deg: number): Angle {
    return new Angle((deg * Math.PI) / 180);
  }

  /** 从百分比坡度创建 (slope% = tan(θ)*100) */
  static fromSlope(slopePercent: number): Angle {
    return new Angle(Math.atan(slopePercent / 100));
  }
}
