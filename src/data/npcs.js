export const NPCS = [
  {
    "id": "npc_001",
    "name": "見習いハイネ",
    "rareChanceRate": 3,
    "difficulty": "よわい",
    "entryFee": 0,
    "winMoney": 100,
    "rareChanceLabel": "★3まで",
    "ruleGroup1": [],
    "ruleGroup2": [],
    "rareChanceRarities": [
      1,
      2,
      3
    ],
    "handPattern": [
      {
        "rarity": 1,
        "count": 3
      },
      {
        "rarity": 2,
        "count": 2
      }
    ],
    "cardPoolSpec": {
      "rarities": [
        1
      ],
      "fixedCardRefs": [
        {
          "name": "[血が見たい]",
          "type": "もなタイプ",
          "rarity": 2
        },
        {
          "name": "[血が見たい]",
          "type": "美雨タイプ",
          "rarity": 2
        },
        {
          "name": "[血が見たい]",
          "type": "凛花タイプ",
          "rarity": 2
        },
        {
          "name": "[血が見たい]",
          "type": "百花タイプ",
          "rarity": 2
        }
      ]
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          1
        ],
        "fixedCardRefs": [
          {
            "name": "[血が見たい]",
            "type": "もなタイプ",
            "rarity": 2
          },
          {
            "name": "[血が見たい]",
            "type": "美雨タイプ",
            "rarity": 2
          },
          {
            "name": "[血が見たい]",
            "type": "凛花タイプ",
            "rarity": 2
          },
          {
            "name": "[血が見たい]",
            "type": "百花タイプ",
            "rarity": 2
          }
        ]
      },
      "3": {
        "rarities": [
          1
        ],
        "fixedCardRefs": [
          {
            "name": "[血が見たい]",
            "type": "もなタイプ",
            "rarity": 2
          },
          {
            "name": "[血が見たい]",
            "type": "美雨タイプ",
            "rarity": 2
          },
          {
            "name": "[血が見たい]",
            "type": "凛花タイプ",
            "rarity": 2
          },
          {
            "name": "[血が見たい]",
            "type": "百花タイプ",
            "rarity": 2
          }
        ]
      }
    }
  },
  {
    "id": "npc_002",
    "name": "修行中ハイネ",
    "rareChanceRate": 3,
    "difficulty": "よわい",
    "entryFee": 50,
    "winMoney": 200,
    "rareChanceLabel": "★3まで",
    "ruleGroup1": [],
    "ruleGroup2": [],
    "rareChanceRarities": [
      1,
      2,
      3
    ],
    "handPattern": [
      {
        "rarity": 1,
        "count": 3
      },
      {
        "rarity": 2,
        "count": 1
      }
    ],
    "cardPoolSpec": {
      "rarities": [
        1,
        2
      ],
      "fixedCardRefs": [
        {
          "name": "クラウドナイン",
          "rarity": 3
        }
      ]
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          1,
          2
        ]
      },
      "3": {
        "rarities": [
          1,
          2
        ],
        "fixedCardRefs": [
          {
            "name": "クラウドナイン",
            "rarity": 3
          }
        ]
      }
    },
    "firstWinRewardCardRef": {
      "name": "クラウドナイン"
    },
    "requiredCardRefs": [
      {
        "name": "クラウドナイン"
      }
    ]
  },
  {
    "id": "npc_003",
    "name": "もなのそっくりさん",
    "rareChanceRate": 3,
    "difficulty": "よわい",
    "entryFee": 100,
    "winMoney": 300,
    "rareChanceLabel": "もなの★3",
    "ruleGroup1": [],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3
    ],
    "rareChanceType": "もなタイプ",
    "handPattern": [
      {
        "rarity": 2,
        "count": 4
      },
      {
        "rarity": 3,
        "count": 1
      }
    ],
    "cardPoolSpec": {
      "rarities": [
        2,
        3
      ],
      "type": "もなタイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "もなタイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "もなタイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "まーさ"
    }
  },
  {
    "id": "npc_004",
    "name": "美雨のそっくりさん",
    "rareChanceRate": 3,
    "difficulty": "よわい",
    "entryFee": 100,
    "winMoney": 300,
    "rareChanceLabel": "美雨の★3",
    "ruleGroup1": [],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3
    ],
    "rareChanceType": "美雨タイプ",
    "handPattern": [
      {
        "rarity": 2,
        "count": 4
      },
      {
        "rarity": 3,
        "count": 1
      }
    ],
    "cardPoolSpec": {
      "rarities": [
        2,
        3
      ],
      "type": "美雨タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "美雨タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "美雨タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "ぐるめ"
    }
  },
  {
    "id": "npc_005",
    "name": "凛花のそっくりさん",
    "rareChanceRate": 3,
    "difficulty": "よわい",
    "entryFee": 100,
    "winMoney": 300,
    "rareChanceLabel": "凛花の★3",
    "ruleGroup1": [],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3
    ],
    "rareChanceType": "凛花タイプ",
    "handPattern": [
      {
        "rarity": 2,
        "count": 4
      },
      {
        "rarity": 3,
        "count": 1
      }
    ],
    "cardPoolSpec": {
      "rarities": [
        2,
        3
      ],
      "type": "凛花タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "凛花タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "凛花タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "しおん"
    }
  },
  {
    "id": "npc_006",
    "name": "百花のそっくりさん",
    "rareChanceRate": 3,
    "difficulty": "よわい",
    "entryFee": 100,
    "winMoney": 300,
    "rareChanceLabel": "百花の★3",
    "ruleGroup1": [],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3
    ],
    "rareChanceType": "百花タイプ",
    "handPattern": [
      {
        "rarity": 2,
        "count": 4
      },
      {
        "rarity": 3,
        "count": 1
      }
    ],
    "cardPoolSpec": {
      "rarities": [
        2,
        3
      ],
      "type": "百花タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "百花タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "百花タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "もち"
    }
  },
  {
    "id": "npc_007",
    "name": "もな",
    "rareChanceRate": 5,
    "difficulty": "ふつう",
    "entryFee": 1000,
    "winMoney": 2500,
    "rareChanceLabel": "もなの★3か★4",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_1",
      "little_2",
      "little_3"
    ],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3,
      4
    ],
    "rareChanceType": "もなタイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4
      ],
      "type": "もなタイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "もなタイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "もなタイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[キミ×]",
      "type": "もなタイプ",
      "rarity": 4
    }
  },
  {
    "id": "npc_008",
    "name": "美雨",
    "rareChanceRate": 5,
    "difficulty": "ふつう",
    "entryFee": 1000,
    "winMoney": 2500,
    "rareChanceLabel": "美雨の★3か★4",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_1",
      "little_2",
      "little_3"
    ],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3,
      4
    ],
    "rareChanceType": "美雨タイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4
      ],
      "type": "美雨タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "美雨タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "美雨タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[キミ×]",
      "type": "美雨タイプ",
      "rarity": 4
    }
  },
  {
    "id": "npc_009",
    "name": "凛花",
    "rareChanceRate": 5,
    "difficulty": "ふつう",
    "entryFee": 1000,
    "winMoney": 2500,
    "rareChanceLabel": "凛花の★3か★4",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_1",
      "little_2",
      "little_3"
    ],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3,
      4
    ],
    "rareChanceType": "凛花タイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4
      ],
      "type": "凛花タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "凛花タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "凛花タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[キミ×]",
      "type": "凛花タイプ",
      "rarity": 4
    }
  },
  {
    "id": "npc_010",
    "name": "百花",
    "rareChanceRate": 5,
    "difficulty": "ふつう",
    "entryFee": 1000,
    "winMoney": 2500,
    "rareChanceLabel": "百花の★3か★4",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_1",
      "little_2",
      "little_3"
    ],
    "ruleGroup2": [],
    "rareChanceRarities": [
      3,
      4
    ],
    "rareChanceType": "百花タイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4
      ],
      "type": "百花タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "百花タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "百花タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[キミ×]",
      "type": "百花タイプ",
      "rarity": 4
    }
  },
  {
    "id": "npc_011",
    "name": "もな【ホラークイーン】",
    "rareChanceRate": 8,
    "difficulty": "つよい",
    "entryFee": 10000,
    "winMoney": 20000,
    "rareChanceLabel": "もなの★4か★5",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_3"
    ],
    "ruleGroup2": [
      "plus",
      "same",
      "combo"
    ],
    "rareChanceRarities": [
      4,
      5
    ],
    "rareChanceType": "もなタイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4,
        5
      ],
      "type": "もなタイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "もなタイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "もなタイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[ホラークイーン]",
      "type": "もなタイプ",
      "rarity": 5
    },
    "requiredCardRefs": [
      {
        "name": "[ホラークイーン]",
        "type": "もなタイプ",
        "rarity": 5
      }
    ]
  },
  {
    "id": "npc_012",
    "name": "美雨【ホラークイーン】",
    "rareChanceRate": 8,
    "difficulty": "つよい",
    "entryFee": 10000,
    "winMoney": 20000,
    "rareChanceLabel": "美雨の★4か★5",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_3"
    ],
    "ruleGroup2": [
      "plus",
      "same",
      "combo"
    ],
    "rareChanceRarities": [
      4,
      5
    ],
    "rareChanceType": "美雨タイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4,
        5
      ],
      "type": "美雨タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "美雨タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "美雨タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[ホラークイーン]",
      "type": "美雨タイプ",
      "rarity": 5
    },
    "requiredCardRefs": [
      {
        "name": "[ホラークイーン]",
        "type": "美雨タイプ",
        "rarity": 5
      }
    ]
  },
  {
    "id": "npc_013",
    "name": "凛花【ホラークイーン】",
    "rareChanceRate": 8,
    "difficulty": "つよい",
    "entryFee": 10000,
    "winMoney": 20000,
    "rareChanceLabel": "凛花の★4か★5",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_3"
    ],
    "ruleGroup2": [
      "plus",
      "same",
      "combo"
    ],
    "rareChanceRarities": [
      4,
      5
    ],
    "rareChanceType": "凛花タイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4,
        5
      ],
      "type": "凛花タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "凛花タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "凛花タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[ホラークイーン]",
      "type": "凛花タイプ",
      "rarity": 5
    },
    "requiredCardRefs": [
      {
        "name": "[ホラークイーン]",
        "type": "凛花タイプ",
        "rarity": 5
      }
    ]
  },
  {
    "id": "npc_014",
    "name": "百花【ホラークイーン】",
    "rareChanceRate": 8,
    "difficulty": "つよい",
    "entryFee": 10000,
    "winMoney": 20000,
    "rareChanceLabel": "百花の★4か★5",
    "ruleGroup1": [
      "order",
      "chaos",
      "all_open",
      "swap",
      "reverse",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "mirror",
      "wild_card",
      "little_3"
    ],
    "ruleGroup2": [
      "plus",
      "same",
      "combo"
    ],
    "rareChanceRarities": [
      4,
      5
    ],
    "rareChanceType": "百花タイプ",
    "cardPoolSpec": {
      "rarities": [
        2,
        3,
        4,
        5
      ],
      "type": "百花タイプ"
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          2
        ],
        "type": "百花タイプ"
      },
      "3": {
        "rarities": [
          2,
          3
        ],
        "type": "百花タイプ"
      }
    },
    "firstWinRewardCardRef": {
      "name": "[ホラークイーン]",
      "type": "百花タイプ",
      "rarity": 5
    },
    "requiredCardRefs": [
      {
        "name": "[ホラークイーン]",
        "type": "百花タイプ",
        "rarity": 5
      }
    ]
  },
  {
    "id": "npc_015",
    "name": "ファントムシータのプロデューサー",
    "rareChanceRate": 10,
    "difficulty": "つよい",
    "entryFee": 100000,
    "winMoney": 200000,
    "rareChanceLabel": "必ず★5",
    "ruleGroup1": [
      "order",
      "chaos",
      "ace_killer",
      "type_ascend",
      "type_descend",
      "plus",
      "same",
      "mirror",
      "wild_card",
      "little_3"
    ],
    "ruleGroup2": [
      "combo"
    ],
    "rareChanceRarities": [
      5
    ],
    "fixedCardRefs": [
      {
        "name": "Moth ti a flame",
        "rarity": 3
      },
      {
        "name": "フレイム・メドゥーサ",
        "rarity": 3
      },
      {
        "name": "百鬼夜行",
        "rarity": 3
      },
      {
        "name": "ふぁんとむ♡らんど",
        "rarity": 3
      },
      {
        "name": "Horror Reading Musical",
        "rarity": 3
      },
      {
        "name": "クラウドナイン",
        "rarity": 3
      },
      {
        "name": "怪忌蝶寫眞集 Maze EP.0",
        "rarity": 3
      },
      {
        "name": "CABINET OF DOLLS 人形蒐集",
        "rarity": 3
      },
      {
        "name": "[キミ×]",
        "type": "もなタイプ",
        "rarity": 4
      },
      {
        "name": "[キミ×]",
        "type": "美雨タイプ",
        "rarity": 4
      },
      {
        "name": "[キミ×]",
        "type": "凛花タイプ",
        "rarity": 4
      },
      {
        "name": "[キミ×]",
        "type": "百花タイプ",
        "rarity": 4
      },
      {
        "name": "Ado",
        "rarity": 5
      }
    ],
    "cardPoolSpec": {
      "fixedCardRefs": [
        {
          "name": "Moth ti a flame",
          "rarity": 3
        },
        {
          "name": "フレイム・メドゥーサ",
          "rarity": 3
        },
        {
          "name": "百鬼夜行",
          "rarity": 3
        },
        {
          "name": "ふぁんとむ♡らんど",
          "rarity": 3
        },
        {
          "name": "Horror Reading Musical",
          "rarity": 3
        },
        {
          "name": "クラウドナイン",
          "rarity": 3
        },
        {
          "name": "怪忌蝶寫眞集 Maze EP.0",
          "rarity": 3
        },
        {
          "name": "CABINET OF DOLLS 人形蒐集",
          "rarity": 3
        },
        {
          "name": "[キミ×]",
          "type": "もなタイプ",
          "rarity": 4
        },
        {
          "name": "[キミ×]",
          "type": "美雨タイプ",
          "rarity": 4
        },
        {
          "name": "[キミ×]",
          "type": "凛花タイプ",
          "rarity": 4
        },
        {
          "name": "[キミ×]",
          "type": "百花タイプ",
          "rarity": 4
        },
        {
          "name": "Ado",
          "rarity": 5
        }
      ]
    },
    "littlePoolSpecs": {
      "1": {
        "rarities": [
          1
        ]
      },
      "2": {
        "rarities": [
          1,
          2
        ]
      },
      "3": {
        "fixedCardRefs": [
          {
            "name": "Moth ti a flame",
            "rarity": 3
          },
          {
            "name": "フレイム・メドゥーサ",
            "rarity": 3
          },
          {
            "name": "百鬼夜行",
            "rarity": 3
          },
          {
            "name": "ふぁんとむ♡らんど",
            "rarity": 3
          },
          {
            "name": "Horror Reading Musical",
            "rarity": 3
          },
          {
            "name": "クラウドナイン",
            "rarity": 3
          },
          {
            "name": "怪忌蝶寫眞集 Maze EP.0",
            "rarity": 3
          },
          {
            "name": "CABINET OF DOLLS 人形蒐集",
            "rarity": 3
          }
        ]
      }
    },
    "firstWinRewardCardRef": {
      "name": "Ado",
      "rarity": 5
    },
    "requiredCardRefs": [
      {
        "name": "Ado",
        "rarity": 5
      }
    ]
  }
];
