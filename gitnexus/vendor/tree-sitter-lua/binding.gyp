{
  "targets": [
    {
      "target_name": "tree_sitter_lua_binding",
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except"
      ],
      "include_dirs": ["src"],
      "sources": [
        "src/parser.c",
        "bindings/node/binding.cc",
        "src/scanner.cc"
      ]
    }
  ]
}
