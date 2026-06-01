<?php

namespace App\Models;

class PsgcRegion extends PrismaModel
{
    protected $table = 'psgc_regions';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = ['id', 'code', 'name', 'shortName'];

    public function provinces()
    {
        return $this->hasMany(PsgcProvince::class, 'regionId');
    }

    public function userProfiles()
    {
        return $this->hasMany(UserProfile::class, 'regionId');
    }

    public function studyTargets()
    {
        return $this->hasMany(StudyLocationTarget::class, 'regionId');
    }
}
