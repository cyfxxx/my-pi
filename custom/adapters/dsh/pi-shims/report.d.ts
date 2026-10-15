/** shim 的统一上报通道（同一 key 只打印一次） */
export declare function reportShim(key: string, detail: string): void;
/** 供测试重置上报去重表（生产代码不应调用） */
export declare function resetShimReports(): void;
