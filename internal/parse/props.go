package parse

import (
	"github.com/golang/geo/r3"
	st "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/sendtables"
)

// Safe property readers. POV demos and freshly created entities can have
// properties without a value, which the library accessors panic on.

func propInt(e st.Entity, name string) int {
	v, ok := e.PropertyValue(name)
	if !ok || v.Any == nil {
		return 0
	}
	return v.Int()
}

func propUint(e st.Entity, name string) uint64 {
	v, ok := e.PropertyValue(name)
	if !ok || v.Any == nil {
		return 0
	}
	return v.UInt64()
}

func propBool(e st.Entity, name string) bool {
	v, ok := e.PropertyValue(name)
	if !ok || v.Any == nil {
		return false
	}
	return v.BoolVal()
}

func propVec(e st.Entity, name string) r3.Vector {
	v, ok := e.PropertyValue(name)
	if !ok || v.Any == nil {
		return r3.Vector{}
	}
	return v.R3Vec()
}

func propString(e st.Entity, name string) string {
	v, ok := e.PropertyValue(name)
	if !ok || v.Any == nil {
		return ""
	}
	return v.String()
}
