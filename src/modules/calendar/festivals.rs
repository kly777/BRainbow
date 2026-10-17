//! 内置传统节日目录。只做“订阅哪些节日”，不替用户决定。
//!
//! 清明是节气，走 `solar_term`；除夕是农历年最后一天，走 `special`。

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Festival {
    pub key: &'static str,
    pub title: &'static str,
    pub calendar: &'static str,
    pub month: Option<i32>,
    pub day: Option<i32>,
    pub term: Option<&'static str>,
    pub special: Option<&'static str>,
    pub note: &'static str,
}

/// 默认订阅的 10 个节日。其余（龙抬头、寒衣、下元、小年）先不放进默认目录。
pub const FESTIVALS: &[Festival] = &[
    Festival {
        key: "festival.spring_festival",
        title: "春节",
        calendar: "lunar",
        month: Some(1),
        day: Some(1),
        term: None,
        special: None,
        note: "正月初一",
    },
    Festival {
        key: "festival.lantern",
        title: "元宵",
        calendar: "lunar",
        month: Some(1),
        day: Some(15),
        term: None,
        special: None,
        note: "正月十五",
    },
    Festival {
        key: "festival.qingming",
        title: "清明",
        calendar: "solar_term",
        month: None,
        day: None,
        term: Some("qingming"),
        special: None,
        note: "节气（只做清明）",
    },
    Festival {
        key: "festival.dragon_boat",
        title: "端午",
        calendar: "lunar",
        month: Some(5),
        day: Some(5),
        term: None,
        special: None,
        note: "五月初五",
    },
    Festival {
        key: "festival.qixi",
        title: "七夕",
        calendar: "lunar",
        month: Some(7),
        day: Some(7),
        term: None,
        special: None,
        note: "七月初七",
    },
    Festival {
        key: "festival.ghost",
        title: "中元",
        calendar: "lunar",
        month: Some(7),
        day: Some(15),
        term: None,
        special: None,
        note: "七月十五",
    },
    Festival {
        key: "festival.mid_autumn",
        title: "中秋",
        calendar: "lunar",
        month: Some(8),
        day: Some(15),
        term: None,
        special: None,
        note: "八月十五",
    },
    Festival {
        key: "festival.double_ninth",
        title: "重阳",
        calendar: "lunar",
        month: Some(9),
        day: Some(9),
        term: None,
        special: None,
        note: "九月初九",
    },
    Festival {
        key: "festival.laba",
        title: "腊八",
        calendar: "lunar",
        month: Some(12),
        day: Some(8),
        term: None,
        special: None,
        note: "腊月初八",
    },
    Festival {
        key: "festival.new_year_eve",
        title: "除夕",
        calendar: "lunar",
        month: None,
        day: None,
        term: None,
        special: Some("new_year_eve"),
        note: "农历年最后一天（廿九或三十）",
    },
];

pub fn find(key: &str) -> Option<&'static Festival> {
    FESTIVALS.iter().find(|festival| festival.key == key)
}
