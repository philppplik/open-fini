// 256 short, distinct, easy-to-say English words for the room verification code (short authentication string).
// One word encodes 8 bits; six words encode 48 bits of the room fingerprint (collab/crypto.js ▸ roomFingerprint).
// Invariants (tested in tests/collab/crypto.test.js): exactly 256 entries, all lowercase a-z, all unique.
// Never reorder or edit this list: two app versions must show the same words for the same room.
export const SAS_WORDS = Object.freeze(
  (
    "acid acorn actor adobe agent alarm album alley amber angel anvil apple apron arena arrow aspen atlas attic " +
    "badge bagel baker banjo barn basil beach beard berry bison blade blaze bloom board bonus boost brass bread " +
    "brick brook brush buddy bunny cabin cable cactus camel candy canoe cargo carol cedar chalk charm chess chief " +
    "cider cliff clock cloud clove coast cobra cocoa comet coral couch crane crown daisy dance denim " +
    "depot diary dingo dough dozen dragon dream drum eagle easel ebony elbow elder ember engine " +
    "fable fairy falcon feast fence ferry fiber field flame flute focus forge fox frost fruit garden gecko " +
    "ghost giant ginger glass globe glove goose grape gravy green guide guitar habit harbor hazel heart hedge " +
    "heron honey hotel humor igloo image index ivory jacket jelly jewel joker juice kayak kettle kiwi koala label " +
    "lagoon lemon level lilac linen lion llama lotus lunar magic mango maple marble meadow melon metal mint " +
    "mirror mocha model moose motor nectar needle noble noodle north nutmeg oasis ocean olive onion " +
    "opera orbit otter owl paddle panda paper patio peach pearl pepper piano pilot pixel plaza plum polar pony " +
    "poppy prism pulse puzzle quail quartz quest quill radar radio raven reef rhino ribbon river robin rocket " +
    "rose ruby saddle salad salmon sandal satin scout shell silver sketch sloth smile solar sonic spark spice " +
    "spoon squid stamp star stone sugar summit sunny swan tango tiger toast topaz torch tower tulip tundra " +
    "turtle unicorn valley vapor velvet venus violet viper vista waffle walnut water whale willow " +
    "wizard yacht zebra zinc"
  ).split(" "),
);
